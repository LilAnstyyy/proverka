import { FilesetResolver, PoseLandmarker, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d');
const repCountEl = document.getElementById('repCount');
const timerEl = document.getElementById('timer');
const feedbackEl = document.getElementById('feedback');
const exerciseNameEl = document.getElementById('exerciseName');

// Две разные модели — для видео и для фото (разные runningMode)
let poseLandmarkerVideo = null;
let poseLandmarkerImage = null;
let currentPoseLandmarker = null;   // текущая используемая модель

// Счётчики и состояния
let repCount = 0;
let plankStartTime = 0;
let currentExercise = 'none';
let previousExercise = 'none';
let squatStage = 'up';      // 'up' | 'down'
let lungeStage = 'standing';

// Стабилизация — последние N определений, чтобы избежать скачков
const HISTORY_LENGTH = 10;  // уменьшили с 15 до 10 — быстрее реагируем на изменения
let exerciseHistory = new Array(HISTORY_LENGTH).fill('none');
let historyIndex = 0;

// Таймер для сброса при долгом отсутствии упражнения
let lastKnownExerciseTime = 0;
const RESET_AFTER_NONE_MS = 1800; // 1.8 секунды "неопределённости" → полный сброс

/**
 * Инициализация модели для режима VIDEO
 */
async function initPoseLandmarkerVideo() {
    if (poseLandmarkerVideo) return poseLandmarkerVideo;

    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    poseLandmarkerVideo = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 1
    });

    return poseLandmarkerVideo;
}

/**
 * Инициализация модели для режима IMAGE (для анализа фотографий)
 */
async function initPoseLandmarkerImage() {
    if (poseLandmarkerImage) return poseLandmarkerImage;

    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    poseLandmarkerImage = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
            delegate: "GPU"
        },
        runningMode: "IMAGE",
        numPoses: 1
    });

    return poseLandmarkerImage;
}

/**
 * Вычисление угла между тремя точками (A-B-C)
 */
function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return angle;
}

/**
 * Находим самое частое значение в массиве (для стабилизации)
 */
function mostFrequent(arr) {
    const count = {};
    arr.forEach(x => { count[x] = (count[x] || 0) + 1; });
    return Object.keys(count).reduce((a, b) => count[a] > count[b] ? a : b, 'none');
}

/**
 * Основная функция определения упражнения (самое важное место!)
 */
function detectRawExercise(landmarks) {
    const nose = landmarks[0];
    const lShoulder = landmarks[11], rShoulder = landmarks[12];
    const lHip = landmarks[23], rHip = landmarks[24];
    const lKnee = landmarks[25], rKnee = landmarks[26];
    const lAnkle = landmarks[27], rAnkle = landmarks[28];

    const leftKneeAngle  = calculateAngle(lHip,   lKnee,  lAnkle);
    const rightKneeAngle = calculateAngle(rHip,   rKnee,  rAnkle);
    const avgKneeAngle   = (leftKneeAngle + rightKneeAngle) / 2;

    const leftBodyAngle  = calculateAngle(lShoulder, lHip, lAnkle);
    const rightBodyAngle = calculateAngle(rShoulder, rHip, rAnkle);
    const avgBodyAngle   = (leftBodyAngle + rightBodyAngle) / 2;

    const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);

    // Проверка положения головы относительно плеч (важно для исключения планки при стоянии)
    const headIsBelow = nose.y > ((lShoulder.y + rShoulder.y) / 2 + 0.08);

    // Планка — очень строгие условия + обязательное положение головы ниже плеч
    const isPlank =
        avgBodyAngle > 165 &&
        avgKneeAngle > 165 &&
        kneeDiff < 16 &&
        Math.abs(lHip.y - rHip.y) < 0.08 &&
        Math.abs(lShoulder.y - rShoulder.y) < 0.08 &&
        headIsBelow;

    // Выпады — умеренно мягкие условия
    const isLunge =
        kneeDiff > 35 &&
        Math.min(leftKneeAngle, rightKneeAngle) < 135 &&
        Math.max(leftKneeAngle, rightKneeAngle) > 145;

    // Приседания — значительно смягчены пороги, чтобы ловить глубокие приседы
    const isSquat =
        avgKneeAngle < 155 &&              // раньше было 128 — слишком строго
        avgKneeAngle > 50 &&               // защита от ложных срабатываний
        kneeDiff < 35 &&                   // допускаем небольшую асимметрию
        avgBodyAngle > 50 && avgBodyAngle < 170; // корпус может быть сильно наклонён

    if (isPlank)  return 'plank';
    if (isLunge)  return 'lunges';
    if (isSquat)  return 'squats';

    return 'none';
}

/**
 * Формируем текстовую обратную связь по технике
 */
function giveFeedback(exercise, landmarks) {
    if (exercise === 'none') {
        return 'Не удалось определить упражнение. Попробуйте встать чётче или сменить ракурс.';
    }

    const lShoulder = landmarks[11], lHip = landmarks[23], lKnee = landmarks[25];

    if (exercise === 'plank') {
        const bodyAngle = calculateAngle(lShoulder, lHip, lKnee);
        if (bodyAngle < 165) return "Поднимите таз — спина должна быть почти прямой!";
        if (bodyAngle > 178) return "Не прогибайтесь в пояснице!";
        return "Отлично! Держите тело ровно.";
    }

    if (exercise === 'squats') {
        const avgKnee = (calculateAngle(lHip, lKnee, landmarks[27]) +
                         calculateAngle(landmarks[24], landmarks[26], landmarks[28])) / 2;
        if (avgKnee > 95) return "Опускайтесь ниже — бёдра хотя бы параллельно полу!";
        return "Хорошая техника! Продолжайте.";
    }

    if (exercise === 'lunges') {
        return "Следите за корпусом — держите его прямо. Заднее колено почти до пола.";
    }

    return "Техника выглядит нормально!";
}

/**
 * Обработка результатов детекции (видео или фото)
 */
function processResults(results, timestamp, isVideo = true) {
    ctx.save();

    if (isVideo) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    if (results.landmarks?.length > 0) {
        const landmarks = results.landmarks[0];
        const drawingUtils = new DrawingUtils(ctx);
        drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, { color: '#00ff9d', lineWidth: 4 });
        drawingUtils.drawLandmarks(landmarks, { color: '#ff3366', radius: 5 });

        // Определяем упражнение
        const raw = detectRawExercise(landmarks);
        exerciseHistory[historyIndex] = raw;
        historyIndex = (historyIndex + 1) % HISTORY_LENGTH;

        const stableExercise = mostFrequent(exerciseHistory);

        // Если долго нет упражнения → полный сброс
        if (stableExercise === 'none') {
            if (performance.now() - lastKnownExerciseTime > RESET_AFTER_NONE_MS) {
                currentExercise = 'none';
                exerciseHistory.fill('none');
                historyIndex = 0;
                repCount = 0;
                plankStartTime = 0;
                squatStage = 'up';
                repCountEl.textContent = '0';
                timerEl.textContent = '0';
                exerciseNameEl.textContent = 'Определение упражнения...';
            }
        } else {
            lastKnownExerciseTime = performance.now();

            // Смена упражнения только если стабильно новое
            if (stableExercise !== currentExercise) {
                currentExercise = stableExercise;
                previousExercise = currentExercise;
                repCount = 0;
                plankStartTime = 0;
                squatStage = 'up';
                lungeStage = 'standing';
                repCountEl.textContent = '0';
                timerEl.textContent = '0';

                const names = {
                    squats: 'Приседания',
                    lunges: 'Выпады',
                    plank:  'Планка'
                };
                exerciseNameEl.textContent = names[currentExercise] || 'Определение...';
            }
        }

        // Таймер планки
        if (currentExercise === 'plank') {
            if (plankStartTime === 0) plankStartTime = timestamp;
            const seconds = Math.floor((timestamp - plankStartTime) / 1000);
            timerEl.textContent = seconds;
        } else {
            plankStartTime = 0;
            timerEl.textContent = '0';
        }

        // Счёт повторений для приседаний
        if (currentExercise === 'squats') {
            const avgKneeAngle = (calculateAngle(landmarks[23], landmarks[25], landmarks[27]) +
                                  calculateAngle(landmarks[24], landmarks[26], landmarks[28])) / 2;

            if (squatStage === 'up' && avgKneeAngle < 95) {
                squatStage = 'down';
            } else if (squatStage === 'down' && avgKneeAngle > 150) {
                squatStage = 'up';
                repCount++;
                repCountEl.textContent = repCount;
            }
        }

        feedbackEl.textContent = giveFeedback(currentExercise, landmarks);
        feedbackEl.style.color = "#39ff14";
    } else {
        feedbackEl.textContent = 'Человек не найден в кадре. Встаньте полностью.';
        feedbackEl.style.color = '#ff4757';
    }

    ctx.restore();
}

/**
 * Цикл обработки видео
 */
function runVideoDetection() {
    if (!currentPoseLandmarker) return;
    const now = performance.now();
    const results = currentPoseLandmarker.detectForVideo(video, now);
    processResults(results, now, true);
    requestAnimationFrame(runVideoDetection);
}

// -----------------------
// Кнопка запуска камеры
// -----------------------
document.getElementById('startButton').addEventListener('click', async () => {
    currentPoseLandmarker = await initPoseLandmarkerVideo();

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: "user" } 
        });
        video.srcObject = stream;
        video.play();
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            runVideoDetection();
        };
    } catch (err) {
        feedbackEl.textContent = "Ошибка доступа к камере: " + err.message;
        feedbackEl.style.color = '#ff4757';
    }
});

// -----------------------
// Кнопка анализа фотографии
// -----------------------
document.getElementById('analyzePhotoButton').addEventListener('click', async () => {
    const fileInput = document.getElementById('photoUpload');
    if (!fileInput.files?.length) {
        feedbackEl.textContent = 'Выберите фото!';
        feedbackEl.style.color = '#ff4757';
        return;
    }

    currentPoseLandmarker = await initPoseLandmarkerImage();

    const file = fileInput.files[0];
    const img = new Image();
    img.src = URL.createObjectURL(file);

    img.onload = async () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        try {
            const bitmap = await createImageBitmap(img);
            const results = await currentPoseLandmarker.detect(bitmap);
            processResults(results, performance.now(), false);
            bitmap.close();
        } catch (e) {
            console.error(e);
            feedbackEl.textContent = 'Ошибка анализа фото: ' + e.message;
            feedbackEl.style.color = '#ff4757';
        }
    };

    img.onerror = () => {
        feedbackEl.textContent = 'Не удалось загрузить изображение.';
        feedbackEl.style.color = '#ff4757';
    };
});