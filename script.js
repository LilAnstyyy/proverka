import { FilesetResolver, PoseLandmarker, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const video = document.getElementById('webcam');
const canvas = document.getElementById('output_canvas');
const ctx = canvas.getContext('2d');
const repCountEl = document.getElementById('repCount');
const timerEl = document.getElementById('timer');
const feedbackEl = document.getElementById('feedback');
const exerciseNameEl = document.getElementById('exerciseName');

let poseLandmarkerVideo = null;
let poseLandmarkerImage = null;
let currentPoseLandmarker = null;   // будет указывать, какую модель используем сейчас

let repCount = 0;
let plankStartTime = 0;
let currentExercise = 'none';
let previousExercise = 'none';
let squatStage = 'up';      // 'up' | 'down'
let lungeStage = 'standing';

// Стабилизация определения упражнения
const HISTORY_LENGTH = 15;
let exerciseHistory = new Array(HISTORY_LENGTH).fill('none');
let historyIndex = 0;

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

function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs(radians * 180.0 / Math.PI);
    if (angle > 180) angle = 360 - angle;
    return angle;
}

function mostFrequent(arr) {
    const count = {};
    arr.forEach(x => { count[x] = (count[x] || 0) + 1; });
    return Object.keys(count).reduce((a, b) => count[a] > count[b] ? a : b, 'none');
}

function detectRawExercise(landmarks) {
    const nose = landmarks[0];
    const lShoulder = landmarks[11], rShoulder = landmarks[12];
    const lHip = landmarks[23], rHip = landmarks[24];
    const lKnee = landmarks[25], rKnee = landmarks[26];
    const lAnkle = landmarks[27], rAnkle = landmarks[28];

    const leftKneeAngle = calculateAngle(lHip, lKnee, lAnkle);
    const rightKneeAngle = calculateAngle(rHip, rKnee, rAnkle);
    const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;

    const leftBodyAngle = calculateAngle(lShoulder, lHip, lAnkle);
    const rightBodyAngle = calculateAngle(rShoulder, rHip, rAnkle);
    const avgBodyAngle = (leftBodyAngle + rightBodyAngle) / 2;

    const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);

    // Голова сильно ниже плеч → вероятность планки выше
    const headIsBelow = nose.y > ((lShoulder.y + rShoulder.y) / 2 + 0.12);

    // Планка — очень жёсткие условия + зависимость от положения головы
    const isPlank =
        avgBodyAngle > 168 &&
        avgKneeAngle > 168 &&
        kneeDiff < 14 &&
        Math.abs(lHip.y - rHip.y) < 0.06 &&
        Math.abs(lShoulder.y - rShoulder.y) < 0.07 &&
        headIsBelow;  // ← самое важное изменение!

    // Выпады (большая асимметрия)
    const isLunge =
        kneeDiff > 42 &&
        Math.min(leftKneeAngle, rightKneeAngle) < 118 &&
        Math.max(leftKneeAngle, rightKneeAngle) > 158;

    // Приседания
    const isSquat =
        avgKneeAngle < 128 &&
        kneeDiff < 25 &&
        avgBodyAngle > 75 && avgBodyAngle < 150;

    if (isPlank)  return 'plank';
    if (isLunge)  return 'lunges';
    if (isSquat)  return 'squats';

    return 'none';
}

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

        // Определение упражнения со стабилизацией
        const raw = detectRawExercise(landmarks);
        exerciseHistory[historyIndex] = raw;
        historyIndex = (historyIndex + 1) % HISTORY_LENGTH;

        const stableExercise = mostFrequent(exerciseHistory);

        // Смена упражнения только если стабильно новое значение
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
                plank:  'Планка'
            };
            exerciseNameEl.textContent = names[currentExercise] || 'Определение...';
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

        // Счёт повторений — приседания (можно расширить на выпады)
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

function runVideoDetection() {
    if (!currentPoseLandmarker) return;
    const now = performance.now();
    const results = currentPoseLandmarker.detectForVideo(video, now);
    processResults(results, now, true);
    requestAnimationFrame(runVideoDetection);
}

// Камера
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

// Фото
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