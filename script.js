import { FilesetResolver, PoseLandmarker, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d');
const repCountEl = document.getElementById('repCount');
const timerEl = document.getElementById('timer');
const feedbackEl = document.getElementById('feedback');
const exerciseNameEl = document.getElementById('exerciseName');

let poseLandmarker = null;
let repCount = 0;
let plankStartTime = 0;
let currentExercise = 'none';
let previousExercise = 'none';
let squatStage = 'up';      // 'up' | 'down'
let lungeStage = 'standing'; // 'standing' | 'down'

// Стабилизация определения упражнения
const HISTORY_LENGTH = 15;
let exerciseHistory = new Array(HISTORY_LENGTH).fill('none');
let historyIndex = 0;

// Для счёта повторений — минимальное время в нижней фазе (сек)
const MIN_PHASE_DURATION = 0.45;

function mostFrequent(arr) {
    const count = {};
    arr.forEach(x => count[x] = (count[x] || 0) + 1);
    return Object.keys(count).reduce((a, b) => count[a] > count[b] ? a : b, null);
}

async function initPoseLandmarker() {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task",
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numPoses: 1
    });

    feedbackEl.textContent = "Модель загружена. Готовы!";
    feedbackEl.style.color = "#39ff14";
}

function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return angle;
}

function detectRawExercise(landmarks) {
    const lHip = landmarks[23], rHip = landmarks[24];
    const lKnee = landmarks[25], rKnee = landmarks[26];
    const lAnkle = landmarks[27], rAnkle = landmarks[28];
    const lShoulder = landmarks[11], rShoulder = landmarks[12];

    const leftKneeAngle = calculateAngle(lHip, lKnee, lAnkle);
    const rightKneeAngle = calculateAngle(rHip, rKnee, rAnkle);
    const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;

    const leftBodyAngle = calculateAngle(lShoulder, lHip, lAnkle);
    const rightBodyAngle = calculateAngle(rShoulder, rHip, rAnkle);
    const avgBodyAngle = (leftBodyAngle + rightBodyAngle) / 2;

    const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);

    // Планка — очень строгие условия
    if (
        avgBodyAngle > 168 &&
        avgKneeAngle > 168 &&
        kneeDiff < 15 &&
        Math.abs(lHip.y - rHip.y) < 0.07 &&
        Math.abs(lShoulder.y - rShoulder.y) < 0.08
    ) {
        return 'plank';
    }

    // Выпады (большая асимметрия)
    if (
        kneeDiff > 40 &&
        Math.min(leftKneeAngle, rightKneeAngle) < 120 &&
        Math.max(leftKneeAngle, rightKneeAngle) > 155
    ) {
        return 'lunges';
    }

    // Приседания
    if (
        avgKneeAngle < 130 &&
        kneeDiff < 28 &&
        avgBodyAngle > 70 && avgBodyAngle < 155
    ) {
        return 'squats';
    }

    return 'none';
}

function giveFeedback(exercise, landmarks) {
    if (exercise === 'none') return 'Не определено. Попробуйте встать более чётко в кадр.';

    const lKnee = landmarks[25], rKnee = landmarks[26];
    const lHip = landmarks[23], rHip = landmarks[24];
    const lShoulder = landmarks[11];

    if (exercise === 'plank') {
        const bodyAngle = calculateAngle(lShoulder, lHip, lKnee);
        if (bodyAngle < 165) return "Поднимите таз выше — спина должна быть почти прямой!";
        if (bodyAngle > 175) return "Не прогибайтесь в пояснице!";
        return "Отлично! Держите планку ровно.";
    }

    if (exercise === 'squats') {
        const avgKnee = (calculateAngle(lHip, lKnee, landmarks[27]) + 
                         calculateAngle(rHip, rKnee, landmarks[28])) / 2;
        if (avgKnee > 90) return "Опускайтесь ниже — бёдра хотя бы параллельны полу!";
        if (lKnee.x < lAnkle.x - 0.1) return "Колени не должны выходить далеко вперёд!";
        return "Хорошо! Продолжайте.";
    }

    if (exercise === 'lunges') {
        return "Держите корпус прямо. Заднее колено почти касается пола.";
    }

    return "Техника выглядит нормально!";
}

function processResults(results, timestamp, isVideo = true) {
    ctx.save();

    if (isVideo) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    } else {
        // Для фото уже нарисовано в обработчике
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

        // Смена упражнения только если стабильно определилось
        if (stableExercise !== 'none' && stableExercise !== currentExercise) {
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
                plank: 'Планка'
            };
            exerciseNameEl.textContent = names[currentExercise] || 'Определение...';
        }

        // Счёт повторений и таймер
        if (currentExercise === 'plank') {
            if (plankStartTime === 0) plankStartTime = timestamp;
            const seconds = Math.floor((timestamp - plankStartTime) / 1000);
            timerEl.textContent = seconds;
        } else {
            plankStartTime = 0;
            timerEl.textContent = '0';
        }

        // Логика повторений для приседаний и выпадов
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
        feedbackEl.textContent = 'Человек не найден. Встаньте полностью в кадр.';
        feedbackEl.style.color = '#ff4757';
    }

    ctx.restore();
}

function runVideoDetection() {
    if (!poseLandmarker) return;
    const now = performance.now();
    const results = poseLandmarker.detectForVideo(video, now);
    processResults(results, now, true);
    requestAnimationFrame(runVideoDetection);
}

// -----------------------
// Запуск камеры
// -----------------------
document.getElementById('startButton').addEventListener('click', async () => {
    if (!poseLandmarker) await initPoseLandmarker();

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
        feedbackEl.textContent = "Не удалось получить доступ к камере: " + err.message;
        feedbackEl.style.color = '#ff4757';
    }
});

// -----------------------
// Анализ фотографии
// -----------------------
document.getElementById('analyzePhotoButton').addEventListener('click', async () => {
    const fileInput = document.getElementById('photoUpload');
    if (!fileInput.files?.length) {
        feedbackEl.textContent = 'Выберите фотографию!';
        feedbackEl.style.color = '#ff4757';
        return;
    }

    if (!poseLandmarker) await initPoseLandmarker();

    const file = fileInput.files[0];
    const img = new Image();
    img.src = URL.createObjectURL(file);

    img.onload = async () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        try {
            const bitmap = await createImageBitmap(img);
            const results = await poseLandmarker.detect(bitmap);
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