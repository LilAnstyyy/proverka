import { FilesetResolver, PoseLandmarker, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d');
const repCountEl = document.getElementById('repCount');
const timerEl = document.getElementById('timer');
const feedbackEl = document.getElementById('feedback');
const exerciseNameEl = document.getElementById('exerciseName');
const startButton = document.getElementById('startButton');
const stopButton = document.getElementById('stopButton');
const analyzePhotoButton = document.getElementById('analyzePhotoButton');
const photoUpload = document.getElementById('photoUpload');

let poseLandmarker = null;
let repCount = 0;
let plankSeconds = 0;
let plankStartTime = 0;
let currentExercise = 'none';
let previousExercise = 'none';
let squatStage = null;
let lungeStage = null;
let animationFrameId = null;
let isCameraActive = false;
let confidenceThreshold = 0.5; // Порог уверенности для детекции
let lastDetectionTime = 0;
let stream = null;

// Инициализация MediaPipe
async function initPoseLandmarker() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5, // Минимальная уверенность в детекции позы
      minPosePresenceConfidence: 0.5, // Минимальная уверенность в наличии позы
      minTrackingConfidence: 0.5 // Минимальная уверенность в трекинге
    });

    feedbackEl.textContent = "Модель загружена. Нажмите 'Включить камеру' или загрузите фото.";
    feedbackEl.style.color = '#00ff00';
  } catch (error) {
    console.error('Ошибка инициализации модели:', error);
    feedbackEl.textContent = "Ошибка загрузки модели. Проверьте интернет соединение.";
    feedbackEl.style.color = '#ff4757';
  }
}

// Расчет угла между тремя точками
function calculateAngle(a, b, c) {
  const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
  let angle = Math.abs(radians * 180.0 / Math.PI);
  if (angle > 180) angle = 360 - angle;
  return angle;
}

// Детекция упражнения с улучшенной логикой
function detectExercise(landmarks) {
  // Если лендмарки неполные, возвращаем 'none'
  if (!landmarks || landmarks.length < 33) return 'none';
  
  const lHip = landmarks[23], lKnee = landmarks[25], lAnkle = landmarks[27];
  const rHip = landmarks[24], rKnee = landmarks[26], rAnkle = landmarks[28];
  const lShoulder = landmarks[11], rShoulder = landmarks[12];
  const lElbow = landmarks[13], rElbow = landmarks[14];
  const lWrist = landmarks[15], rWrist = landmarks[16];

  // Проверяем, что все необходимые точки видны
  const requiredPoints = [lHip, lKnee, lAnkle, rHip, rKnee, rAnkle, lShoulder, rShoulder];
  if (requiredPoints.some(point => !point || point.visibility < 0.3)) {
    return 'none';
  }

  const leftKneeAngle = calculateAngle(lHip, lKnee, lAnkle);
  const rightKneeAngle = calculateAngle(rHip, rKnee, rAnkle);
  const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
  const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);

  const bodyLineAngle = calculateAngle(lShoulder, lHip, lAnkle);
  
  // Дополнительная проверка на планку - углы в локтях должны быть близки к 90°
  const leftElbowAngle = calculateAngle(lShoulder, lElbow, lWrist);
  const rightElbowAngle = calculateAngle(rShoulder, rElbow, rWrist);
  const avgElbowAngle = (leftElbowAngle + rightElbowAngle) / 2;

  // Планка: тело прямое (угол > 160), колени почти прямые (> 150), локти согнуты (~90°)
  if (bodyLineAngle > 160 && avgKneeAngle > 150 && avgElbowAngle > 70 && avgElbowAngle < 110) {
    return 'plank';
  }
  
  // Выпады: большая разница в углах коленей и одно колено сильно согнуто
  if (kneeDiff > 40 && (leftKneeAngle < 110 || rightKneeAngle < 110)) {
    return 'lunges';
  }
  
  // Приседания: оба колена согнуты примерно одинаково
  if (avgKneeAngle < 120 && kneeDiff < 30) {
    return 'squats';
  }
  
  return 'none';
}

// Функция обратной связи
function giveFeedback(exercise, landmarks) {
  if (exercise === 'none') {
    feedbackEl.style.color = '#ffd93d';
    return 'Упражнение не распознано. Убедитесь, что все тело в кадре и видно четко.';
  }

  const lHip = landmarks[23], lKnee = landmarks[25], lAnkle = landmarks[27];
  const rHip = landmarks[24], rKnee = landmarks[26], rAnkle = landmarks[28];
  const lShoulder = landmarks[11], rShoulder = landmarks[12];

  const leftKneeAngle = calculateAngle(lHip, lKnee, lAnkle);
  const rightKneeAngle = calculateAngle(rHip, rKnee, rAnkle);

  if (exercise === 'squats') {
    if (!squatStage) squatStage = 'up';
    
    if (squatStage === 'up' && (leftKneeAngle < 100 || rightKneeAngle < 100)) {
      squatStage = 'down';
    } else if (squatStage === 'down' && leftKneeAngle > 160 && rightKneeAngle > 160) {
      squatStage = 'up';
      repCount++;
      repCountEl.textContent = repCount;
    }

    const avgAngle = (leftKneeAngle + rightKneeAngle) / 2;
    if (avgAngle < 90) {
      feedbackEl.style.color = '#ff4757';
      return 'Слишком глубокое приседание! Колени не должны выходить за носки.';
    } else if (avgAngle < 120) {
      feedbackEl.style.color = '#ffa502';
      return 'Хорошая глубина приседания. Поднимайтесь!';
    } else {
      feedbackEl.style.color = '#00ff00';
      return 'Готовы к следующему приседанию. Опускайтесь медленно.';
    }
  }

  if (exercise === 'lunges') {
    if (!lungeStage) lungeStage = 'up';
    
    const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);
    if (lungeStage === 'up' && kneeDiff > 50) {
      lungeStage = 'down';
    } else if (lungeStage === 'down' && kneeDiff < 20) {
      lungeStage = 'up';
      repCount++;
      repCountEl.textContent = repCount;
    }

    const frontKneeAngle = Math.min(leftKneeAngle, rightKneeAngle);
    if (frontKneeAngle < 80) {
      feedbackEl.style.color = '#ff4757';
      return 'Колено слишком выдвинуто вперед! Держите его над стопой.';
    } else {
      feedbackEl.style.color = '#00ff00';
      return 'Хорошая техника выпада. Спина прямая!';
    }
  }

  if (exercise === 'plank') {
    const bodyLineAngle = calculateAngle(lShoulder, lHip, lAnkle);
    
    if (plankStartTime === 0) {
      plankStartTime = Date.now();
    }
    
    const currentTime = Math.floor((Date.now() - plankStartTime) / 1000);
    timerEl.textContent = currentTime;
    
    if (bodyLineAngle > 170) {
      feedbackEl.style.color = '#00ff00';
      return `Отличная планка! Тело прямое. Время: ${currentTime} сек`;
    } else if (bodyLineAngle > 160) {
      feedbackEl.style.color = '#ffa502';
      return 'Поднимите таз немного выше! Тело должно быть прямой линией.';
    } else {
      feedbackEl.style.color = '#ff4757';
      return 'Таз слишком высоко! Опустите его, чтобы тело было прямо.';
    }
  }

  feedbackEl.style.color = '#ffd93d';
  return 'Выполняйте упражнение...';
}

// Обработка результатов детекции
function processResults(results, isVideo = true) {
  if (!results || !results.landmarks || results.landmarks.length === 0) {
    if (isVideo && isCameraActive) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
    feedbackEl.textContent = 'Человек не найден в кадре. Убедитесь, что все тело видно.';
    feedbackEl.style.color = '#ff4757';
    
    // Сброс счетчиков если человек не виден
    if (isCameraActive) {
      currentExercise = 'none';
      exerciseNameEl.textContent = 'Человек не найден';
    }
    return;
  }

  // Проверяем уверенность детекции
  if (results.worldLandmarks && results.worldLandmarks.length > 0) {
    const landmarks = results.landmarks[0];
    
    // Рисуем видео или фото
    if (isVideo && isCameraActive) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    // Рисуем скелет
    const drawingUtils = new DrawingUtils(ctx);
    drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { 
      color: '#00FF00', 
      lineWidth: 4 
    });
    drawingUtils.drawLandmarks(landmarks, { 
      color: '#FF0000', 
      radius: 6 
    });

    // Детекция упражнения
    const detected = detectExercise(landmarks);
    
    if (detected !== 'none' || !isCameraActive) {
      currentExercise = detected;
    }

    // Обработка смены упражнения
    if (currentExercise !== previousExercise) {
      previousExercise = currentExercise;
      
      if (currentExercise === 'none') {
        repCount = 0;
        repCountEl.textContent = '0';
        plankStartTime = 0;
        timerEl.textContent = '0';
        squatStage = null;
        lungeStage = null;
        exerciseNameEl.textContent = 'Определение...';
      } else {
        const names = { 
          squats: 'Приседания', 
          lunges: 'Выпады', 
          plank: 'Планка' 
        };
        exerciseNameEl.textContent = names[currentExercise] || 'Определение...';
        
        // Сброс счетчиков при смене упражнения
        if (previousExercise !== 'none') {
          repCount = 0;
          repCountEl.textContent = '0';
          plankStartTime = 0;
          timerEl.textContent = '0';
        }
      }
    }

    // Обратная связь
    feedbackEl.textContent = giveFeedback(currentExercise, landmarks);
    lastDetectionTime = Date.now();
  }
}

// Детекция с видео
function runVideoDetection() {
  if (!poseLandmarker || !isCameraActive) {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    return;
  }

  try {
    const results = poseLandmarker.detectForVideo(video, performance.now());
    processResults(results, true);
    
    if (isCameraActive) {
      animationFrameId = requestAnimationFrame(runVideoDetection);
    }
  } catch (error) {
    console.error('Ошибка детекции:', error);
    if (isCameraActive) {
      animationFrameId = requestAnimationFrame(runVideoDetection);
    }
  }
}

// Включение камеры
startButton.addEventListener('click', async () => {
  if (!poseLandmarker) {
    await initPoseLandmarker();
  }

  try {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      } 
    });

    video.srcObject = stream;
    await video.play();
    
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    isCameraActive = true;
    startButton.style.display = 'none';
    stopButton.style.display = 'inline-block';
    
    // Сброс счетчиков при включении камеры
    repCount = 0;
    repCountEl.textContent = '0';
    plankSeconds = 0;
    timerEl.textContent = '0';
    currentExercise = 'none';
    previousExercise = 'none';
    
    feedbackEl.textContent = "Камера включена. Встаньте в кадр и начните упражнение.";
    feedbackEl.style.color = '#00ff00';
    
    runVideoDetection();
  } catch (error) {
    console.error('Ошибка камеры:', error);
    feedbackEl.textContent = "Ошибка доступа к камере: " + error.message;
    feedbackEl.style.color = '#ff4757';
  }
});

// Выключение камеры
stopButton.addEventListener('click', () => {
  isCameraActive = false;
  
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  
  video.srcObject = null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  startButton.style.display = 'inline-block';
  stopButton.style.display = 'none';
  
  feedbackEl.textContent = "Камера выключена. Можете загрузить фото для анализа.";
  feedbackEl.style.color = '#ffd93d';
  
  // Сброс данных
  repCount = 0;
  repCountEl.textContent = '0';
  timerEl.textContent = '0';
  currentExercise = 'none';
  exerciseNameEl.textContent = 'Камера выключена';
});

// Анализ фото
analyzePhotoButton.addEventListener('click', async () => {
  if (!photoUpload.files || photoUpload.files.length === 0) {
    feedbackEl.textContent = 'Сначала выберите фото!';
    feedbackEl.style.color = '#ff4757';
    return;
  }

  if (!poseLandmarker) {
    await initPoseLandmarker();
  }

  // Выключаем камеру если она включена
  if (isCameraActive) {
    stopButton.click();
  }

  const file = photoUpload.files[0];
  const img = new Image();
  img.src = URL.createObjectURL(file);

  img.onload = async () => {
    // Устанавливаем размер канваса под фото
    const maxWidth = 720;
    const maxHeight = 480;
    let width = img.width;
    let height = img.height;

    // Масштабируем если фото слишком большое
    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.floor(width * ratio);
      height = Math.floor(height * ratio);
    }

    canvas.width = width;
    canvas.height = height;
    
    // Очищаем и рисуем фото
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, width, height);

    try {
      // Создаем ImageData для MediaPipe
      const imageData = ctx.getImageData(0, 0, width, height);
      
      // Используем правильный формат для MediaPipe
      const mpImage = {
        data: new Uint8Array(imageData.data),
        width: width,
        height: height,
        format: 'SRGB'
      };

      const results = poseLandmarker.detect(mpImage);
      
      // Сбрасываем счетчики для анализа фото
      repCount = 0;
      repCountEl.textContent = '0';
      timerEl.textContent = '0';
      currentExercise = 'none';
      previousExercise = 'none';
      
      processResults(results, false);

      if (!results.landmarks || results.landmarks.length === 0) {
        feedbackEl.textContent = 'Не удалось найти позу на фото. Попробуйте другое фото.';
        feedbackEl.style.color = '#ff4757';
        exerciseNameEl.textContent = 'Поза не найдена';
      }
    } catch (error) {
      console.error('Ошибка анализа фото:', error);
      feedbackEl.textContent = 'Ошибка анализа фото. Попробуйте другое изображение.';
      feedbackEl.style.color = '#ff4757';
    }
    
    // Освобождаем URL
    URL.revokeObjectURL(img.src);
  };

  img.onerror = () => {
    feedbackEl.textContent = 'Ошибка загрузки изображения.';
    feedbackEl.style.color = '#ff4757';
  };
});

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
  await initPoseLandmarker();
});