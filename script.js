// Глобальные переменные
let poseLandmarker = null;
let video = null;
let canvas = null;
let ctx = null;
let repCount = 0;
let currentExercise = 'none';
let previousExercise = 'none';
let animationFrameId = null;
let isCameraActive = false;
let stream = null;

// Элементы DOM
let repCountEl, timerEl, feedbackEl, exerciseNameEl;
let startButton, stopButton, analyzePhotoButton, photoUpload;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
  console.log('DOM загружен');
  
  // Инициализация элементов DOM
  video = document.getElementById('webcam');
  canvas = document.getElementById('output_canvas');
  ctx = canvas.getContext('2d');
  repCountEl = document.getElementById('repCount');
  timerEl = document.getElementById('timer');
  feedbackEl = document.getElementById('feedback');
  exerciseNameEl = document.getElementById('exerciseName');
  startButton = document.getElementById('startButton');
  stopButton = document.getElementById('stopButton');
  analyzePhotoButton = document.getElementById('analyzePhotoButton');
  photoUpload = document.getElementById('photoUpload');
  
  // Инициализация MediaPipe
  initPoseLandmarker();
  
  // Назначение обработчиков событий
  startButton.addEventListener('click', startCamera);
  stopButton.addEventListener('click', stopCamera);
  analyzePhotoButton.addEventListener('click', analyzePhoto);
});

// Инициализация MediaPipe Pose Landmarker
async function initPoseLandmarker() {
  try {
    console.log('Начинаем загрузку MediaPipe...');
    feedbackEl.textContent = "Загрузка AI модели...";
    
    // Проверяем, доступен ли MediaPipe
    if (typeof vision === 'undefined') {
      feedbackEl.textContent = "Ошибка: MediaPipe не загружен. Проверьте интернет соединение.";
      return;
    }
    
    // Используем глобальный объект vision из CDN
    const vision = window.vision;
    
    // Создаем FilesetResolver
    const filesetResolver = await vision.FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    
    console.log('FilesetResolver создан');
    
    // Создаем PoseLandmarker
    poseLandmarker = await vision.PoseLandmarker.createFromOptions(filesetResolver, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    
    console.log('PoseLandmarker создан');
    feedbackEl.textContent = "Модель загружена! Нажмите 'Включить камеру' или загрузите фото.";
    feedbackEl.style.color = '#00ff00';
    
  } catch (error) {
    console.error('Ошибка инициализации модели:', error);
    feedbackEl.textContent = "Ошибка загрузки модели. Обновите страницу или проверьте интернет.";
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

// Определение упражнения
function detectExercise(landmarks) {
  if (!landmarks || landmarks.length < 33) return 'none';
  
  const lHip = landmarks[23], lKnee = landmarks[25], lAnkle = landmarks[27];
  const rHip = landmarks[24], rKnee = landmarks[26], rAnkle = landmarks[28];
  const lShoulder = landmarks[11], rShoulder = landmarks[12];
  
  if (!lHip || !lKnee || !lAnkle || !rHip || !rKnee || !rAnkle) return 'none';
  
  const leftKneeAngle = calculateAngle(lHip, lKnee, lAnkle);
  const rightKneeAngle = calculateAngle(rHip, rKnee, rAnkle);
  const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
  const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);
  
  const bodyLineAngle = calculateAngle(lShoulder, lHip, lAnkle);
  
  // Простая логика для начала
  if (bodyLineAngle > 160 && avgKneeAngle > 150) return 'plank';
  if (kneeDiff > 30 && (leftKneeAngle < 120 || rightKneeAngle < 120)) return 'lunges';
  if (avgKneeAngle < 130 && kneeDiff < 25) return 'squats';
  
  return 'none';
}

// Включение камеры
async function startCamera() {
  console.log('Нажата кнопка Включить камеру');
  
  if (!poseLandmarker) {
    feedbackEl.textContent = "Модель еще загружается...";
    feedbackEl.style.color = '#ffa502';
    return;
  }
  
  // Останавливаем предыдущий стрим если есть
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }
  
  try {
    // Запрашиваем доступ к камере
    stream = await navigator.mediaDevices.getUserMedia({ 
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    });
    
    console.log('Доступ к камере получен');
    
    // Настраиваем видео элемент
    video.srcObject = stream;
    
    // Ждем загрузки метаданных видео
    await new Promise((resolve) => {
      video.onloadedmetadata = () => {
        console.log('Размер видео:', video.videoWidth, 'x', video.videoHeight);
        resolve();
      };
    });
    
    await video.play();
    
    // Настраиваем canvas под размер видео
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    // Обновляем UI
    isCameraActive = true;
    startButton.style.display = 'none';
    stopButton.style.display = 'inline-block';
    
    // Сброс счетчиков
    repCount = 0;
    repCountEl.textContent = '0';
    currentExercise = 'none';
    previousExercise = 'none';
    
    feedbackEl.textContent = "Камера включена. Встаньте в кадр и начните упражнение.";
    feedbackEl.style.color = '#00ff00';
    exerciseNameEl.textContent = 'Определение упражнения...';
    
    console.log('Запускаем детекцию...');
    // Запускаем детекцию
    runDetection();
    
  } catch (error) {
    console.error('Ошибка камеры:', error);
    feedbackEl.textContent = "Ошибка доступа к камере: " + error.message;
    feedbackEl.style.color = '#ff4757';
    
    if (error.name === 'NotAllowedError') {
      feedbackEl.textContent = "Доступ к камере запрещен. Разрешите доступ в настройках браузера.";
    } else if (error.name === 'NotFoundError') {
      feedbackEl.textContent = "Камера не найдена. Убедитесь, что камера подключена.";
    }
  }
}

// Выключение камеры
function stopCamera() {
  console.log('Нажата кнопка Выключить камеру');
  
  isCameraActive = false;
  
  // Останавливаем анимацию
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  // Останавливаем поток камеры
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  
  video.srcObject = null;
  
  // Очищаем canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#333';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  ctx.font = '20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('Камера выключена', canvas.width/2, canvas.height/2);
  
  // Обновляем UI
  startButton.style.display = 'inline-block';
  stopButton.style.display = 'none';
  
  feedbackEl.textContent = "Камера выключена. Можете загрузить фото для анализа.";
  feedbackEl.style.color = '#ffd93d';
  exerciseNameEl.textContent = 'Камера выключена';
}

// Основной цикл детекции
function runDetection() {
  if (!poseLandmarker || !isCameraActive) {
    return;
  }
  
  try {
    // Рисуем текущий кадр видео на canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    // Детектируем позу
    const results = poseLandmarker.detectForVideo(video, performance.now());
    
    if (results.landmarks && results.landmarks.length > 0) {
      const landmarks = results.landmarks[0];
      
      // Рисуем скелет
      const drawingUtils = new window.vision.DrawingUtils(ctx);
      drawingUtils.drawConnectors(
        landmarks, 
        window.vision.PoseLandmarker.POSE_CONNECTIONS, 
        { color: '#00FF00', lineWidth: 4 }
      );
      drawingUtils.drawLandmarks(
        landmarks, 
        { color: '#FF0000', radius: 6 }
      );
      
      // Определяем упражнение
      const detected = detectExercise(landmarks);
      if (detected !== 'none') {
        currentExercise = detected;
      }
      
      // Обновляем UI если упражнение изменилось
      if (currentExercise !== previousExercise) {
        previousExercise = currentExercise;
        
        const names = { 
          squats: 'Приседания', 
          lunges: 'Выпады', 
          plank: 'Планка' 
        };
        exerciseNameEl.textContent = names[currentExercise] || 'Определение...';
      }
      
      // Простая обратная связь
      if (currentExercise === 'none') {
        feedbackEl.textContent = 'Упражнение не распознано. Встаньте в кадр полностью.';
        feedbackEl.style.color = '#ffd93d';
      } else {
        feedbackEl.textContent = `Выполняется: ${exerciseNameEl.textContent}`;
        feedbackEl.style.color = '#00ff00';
      }
      
    } else {
      feedbackEl.textContent = 'Человек не найден в кадре. Встаньте в центр.';
      feedbackEl.style.color = '#ff4757';
    }
    
  } catch (error) {
    console.error('Ошибка детекции:', error);
    feedbackEl.textContent = 'Ошибка анализа видео';
    feedbackEl.style.color = '#ff4757';
  }
  
  // Продолжаем цикл если камера активна
  if (isCameraActive) {
    animationFrameId = requestAnimationFrame(runDetection);
  }
}

// Анализ фото
async function analyzePhoto() {
  console.log('Нажата кнопка Анализировать фото');
  
  if (!photoUpload.files || photoUpload.files.length === 0) {
    feedbackEl.textContent = 'Сначала выберите фото!';
    feedbackEl.style.color = '#ff4757';
    return;
  }
  
  if (!poseLandmarker) {
    feedbackEl.textContent = "Модель еще загружается...";
    feedbackEl.style.color = '#ffa502';
    return;
  }
  
  // Выключаем камеру если она включена
  if (isCameraActive) {
    stopCamera();
  }
  
  const file = photoUpload.files[0];
  const img = new Image();
  
  img.onload = function() {
    // Устанавливаем размер canvas под фото
    canvas.width = img.width;
    canvas.height = img.height;
    
    // Рисуем фото на canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    
    try {
      // Конвертируем изображение для MediaPipe
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      
      // Создаем объект изображения для MediaPipe
      const mpImage = {
        data: new Uint8ClampedArray(imageData.data),
        width: canvas.width,
        height: canvas.height,
        format: 'SRGB'
      };
      
      // Детектируем позу на фото
      const results = poseLandmarker.detect(mpImage);
      
      if (results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        
        // Рисуем скелет
        const drawingUtils = new window.vision.DrawingUtils(ctx);
        drawingUtils.drawConnectors(
          landmarks, 
          window.vision.PoseLandmarker.POSE_CONNECTIONS, 
          { color: '#00FF00', lineWidth: 4 }
        );
        drawingUtils.drawLandmarks(
          landmarks, 
          { color: '#FF0000', radius: 6 }
        );
        
        // Определяем упражнение
        const detected = detectExercise(landmarks);
        
        const names = { 
          squats: 'Приседания', 
          lunges: 'Выпады', 
          plank: 'Планка' 
        };
        
        if (detected !== 'none') {
          exerciseNameEl.textContent = names[detected] || 'Упражнение распознано';
          feedbackEl.textContent = `На фото обнаружено: ${names[detected]}`;
          feedbackEl.style.color = '#00ff00';
        } else {
          exerciseNameEl.textContent = 'Упражнение не распознано';
          feedbackEl.textContent = 'Не удалось определить упражнение на фото';
          feedbackEl.style.color = '#ffd93d';
        }
        
      } else {
        feedbackEl.textContent = 'Не удалось найти человека на фото';
        feedbackEl.style.color = '#ff4757';
        exerciseNameEl.textContent = 'Поза не найдена';
      }
      
    } catch (error) {
      console.error('Ошибка анализа фото:', error);
      feedbackEl.textContent = 'Ошибка анализа фото. Попробуйте другое изображение.';
      feedbackEl.style.color = '#ff4757';
    }
  };
  
  img.onerror = function() {
    feedbackEl.textContent = 'Ошибка загрузки изображения';
    feedbackEl.style.color = '#ff4757';
  };
  
  img.src = URL.createObjectURL(file);
}