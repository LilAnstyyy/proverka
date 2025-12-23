// Глобальные переменные
let poseLandmarker = null;
let video = null;
let canvas = null;
let ctx = null;
let isCameraActive = false;
let stream = null;
let animationFrameId = null;
let lastTime = 0;
let frameCount = 0;
let fps = 0;

// Состояние упражнений
let state = {
    exercise: 'none',
    repCount: 0,
    plankTime: 0,
    plankStart: null,
    squatState: 'up',
    lungeState: 'up',
    pushupState: 'up',
    confidence: 0,
    lastExerciseChange: Date.now()
};

// Элементы DOM
let elements = {};

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async function() {
    console.log('Загрузка страницы...');
    initializeElements();
    setupEventListeners();
    await initializeMediaPipe();
});

function initializeElements() {
    video = document.getElementById('webcam');
    canvas = document.getElementById('output_canvas');
    ctx = canvas.getContext('2d');
    
    elements = {
        repCount: document.getElementById('repCount'),
        timer: document.getElementById('timer'),
        feedback: document.getElementById('feedback'),
        exerciseName: document.getElementById('exerciseName'),
        confidence: document.getElementById('confidence'),
        state: document.getElementById('state'),
        status: document.getElementById('status'),
        fps: document.getElementById('fps'),
        progressBar: document.getElementById('progressBar'),
        progressText: document.getElementById('progressText'),
        startButton: document.getElementById('startButton'),
        stopButton: document.getElementById('stopButton'),
        resetButton: document.getElementById('resetButton'),
        analyzePhotoButton: document.getElementById('analyzePhotoButton'),
        photoUpload: document.getElementById('photoUpload')
    };
}

function setupEventListeners() {
    elements.startButton.addEventListener('click', startCamera);
    elements.stopButton.addEventListener('click', stopCamera);
    elements.resetButton.addEventListener('click', resetState);
    elements.analyzePhotoButton.addEventListener('click', analyzePhoto);
}

// Обновление прогресс-бара
function updateProgress(percentage, text) {
    elements.progressBar.style.width = `${percentage}%`;
    elements.progressText.textContent = text;
}

// Инициализация MediaPipe
async function initializeMediaPipe() {
    try {
        console.log('Инициализация MediaPipe...');
        updateProgress(10, 'Подготовка MediaPipe...');
        
        // Ждем загрузки vision объекта
        await new Promise(resolve => {
            if (window.vision) resolve();
            else setTimeout(resolve, 100);
        });
        
        updateProgress(30, 'Загрузка WASM файлов...');
        
        // Используем более легкую модель для скорости
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
        );
        
        updateProgress(60, 'Загрузка модели pose landmarker...');
        
        // Используем LITE модель для скорости
        poseLandmarker = await vision.PoseLandmarker.createFromOptions(
            filesetResolver,
            {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
                    delegate: "GPU"
                },
                runningMode: "VIDEO",
                numPoses: 1,
                minPoseDetectionConfidence: 0.5,
                minPosePresenceConfidence: 0.5,
                minTrackingConfidence: 0.5
            }
        );
        
        updateProgress(100, 'Модель загружена!');
        setTimeout(() => {
            elements.progressBar.style.display = 'none';
            elements.progressText.style.display = 'none';
        }, 1000);
        
        console.log('MediaPipe Pose Landmarker успешно загружен');
        elements.feedback.textContent = 'Модель готова! Нажмите "Включить камеру"';
        elements.feedback.style.color = '#4caf50';
        elements.status.textContent = 'Готов';
        
    } catch (error) {
        console.error('Ошибка инициализации MediaPipe:', error);
        updateProgress(0, 'Ошибка загрузки модели');
        elements.feedback.textContent = 'Ошибка загрузки модели. Попробуйте перезагрузить страницу.';
        elements.feedback.style.color = '#f44336';
        elements.status.textContent = 'Ошибка';
    }
}

// Запуск камеры
async function startCamera() {
    console.log('Запуск камеры...');
    
    if (!poseLandmarker) {
        elements.feedback.textContent = 'Модель еще загружается...';
        return;
    }
    
    if (stream) {
        stopCamera();
    }
    
    try {
        elements.status.textContent = 'Запрос доступа к камере...';
        
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",
                width: { ideal: 1280, max: 1280 },
                height: { ideal: 720, max: 720 },
                frameRate: { ideal: 30 }
            },
            audio: false
        });
        
        video.srcObject = stream;
        
        await new Promise((resolve) => {
            video.onloadedmetadata = () => {
                console.log('Размер видео:', video.videoWidth, 'x', video.videoHeight);
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                resolve();
            };
        });
        
        await video.play();
        
        isCameraActive = true;
        elements.startButton.style.display = 'none';
        elements.stopButton.style.display = 'flex';
        
        resetState();
        
        elements.feedback.textContent = 'Камера включена. Встаньте в кадр и начните упражнение.';
        elements.feedback.style.color = '#4caf50';
        elements.status.textContent = 'Камера активна';
        elements.state.textContent = 'Ожидание';
        
        console.log('Запуск детекции...');
        detectPose();
        
    } catch (error) {
        console.error('Ошибка камеры:', error);
        handleCameraError(error);
    }
}

// Обработка ошибок камеры
function handleCameraError(error) {
    let errorMessage = 'Ошибка камеры: ';
    
    if (error.name === 'NotAllowedError') {
        errorMessage = '❌ Доступ к камере запрещен. Разрешите доступ в настройках браузера.';
    } else if (error.name === 'NotFoundError') {
        errorMessage = '❌ Камера не найдена. Убедитесь, что камера подключена.';
    } else if (error.name === 'NotReadableError') {
        errorMessage = '❌ Камера уже используется другим приложением.';
    } else if (error.name === 'OverconstrainedError') {
        errorMessage = '❌ Не удалось получить видео с указанными параметрами.';
    } else {
        errorMessage += error.message;
    }
    
    elements.feedback.textContent = errorMessage;
    elements.feedback.style.color = '#f44336';
    elements.status.textContent = 'Ошибка';
}

// Остановка камеры
function stopCamera() {
    console.log('Остановка камеры...');
    
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
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '28px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Камера выключена', canvas.width / 2, canvas.height / 2);
    
    elements.startButton.style.display = 'flex';
    elements.stopButton.style.display = 'none';
    
    elements.feedback.textContent = 'Камера выключена. Можете загрузить фото для анализа.';
    elements.feedback.style.color = '#ff9800';
    elements.status.textContent = 'Остановлено';
    elements.state.textContent = 'Ожидание';
}

// Сброс состояния
function resetState() {
    state = {
        exercise: 'none',
        repCount: 0,
        plankTime: 0,
        plankStart: null,
        squatState: 'up',
        lungeState: 'up',
        pushupState: 'up',
        confidence: 0,
        lastExerciseChange: Date.now()
    };
    
    updateUI();
    elements.feedback.textContent = 'Состояние сброшено. Готовы к новому упражнению!';
    elements.feedback.style.color = '#4caf50';
}

// Обновление UI
function updateUI() {
    elements.repCount.textContent = state.repCount;
    elements.timer.textContent = `${state.plankTime} сек`;
    elements.confidence.textContent = `Уверенность: ${Math.round(state.confidence * 100)}%`;
    elements.state.textContent = getStateText();
    
    const exerciseNames = {
        'squats': '🏋️ Приседания',
        'lunges': '🦵 Выпады',
        'plank': '🧍 Планка',
        'pushups': '💪 Отжимания',
        'none': '🎯 Ожидание упражнения'
    };
    
    elements.exerciseName.textContent = exerciseNames[state.exercise];
}

function getStateText() {
    if (state.exercise === 'none') return 'Ожидание';
    if (state.exercise === 'plank') return 'Удержание';
    return state[`${state.exercise}State`] === 'up' ? 'Вверх' : 'Вниз';
}

// Расчет FPS
function calculateFPS() {
    frameCount++;
    const now = performance.now();
    
    if (now >= lastTime + 1000) {
        fps = Math.round((frameCount * 1000) / (now - lastTime));
        elements.fps.textContent = `FPS: ${fps}`;
        frameCount = 0;
        lastTime = now;
    }
}

// Основная функция детекции
function detectPose() {
    if (!poseLandmarker || !isCameraActive) return;
    
    calculateFPS();
    
    try {
        // Детекция позы
        const results = poseLandmarker.detectForVideo(video, performance.now());
        
        // Рисуем видео на canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        if (results.landmarks && results.landmarks.length > 0) {
            const landmarks = results.landmarks[0];
            const worldLandmarks = results.worldLandmarks ? results.worldLandmarks[0] : null;
            
            // Рисуем скелет MediaPipe
            drawMediaPipeSkeleton(landmarks);
            
            // Получаем уверенность
            state.confidence = results.landmarks[0].reduce((acc, point) => acc + (point.visibility || 0), 0) / results.landmarks[0].length;
            
            // Определяем упражнение
            const detectedExercise = detectExercise(landmarks, worldLandmarks);
            
            // Обновляем состояние упражнения
            updateExerciseState(detectedExercise, landmarks);
            
            // Обновляем обратную связь
            updateFeedback();
            
        } else {
            elements.feedback.textContent = 'Человек не найден в кадре. Встаньте так, чтобы все тело было видно.';
            elements.feedback.style.color = '#ff9800';
            state.confidence = 0;
        }
        
        updateUI();
        
    } catch (error) {
        console.error('Ошибка детекции:', error);
    }
    
    if (isCameraActive) {
        animationFrameId = requestAnimationFrame(detectPose);
    }
}

// Рисование скелета MediaPipe
function drawMediaPipeSkeleton(landmarks) {
    if (!landmarks) return;
    
    // Соединения для MediaPipe Pose (33 точки)
    const connections = vision.PoseLandmarker.POSE_CONNECTIONS;
    
    // Рисуем соединения
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    
    connections.forEach(([startIdx, endIdx]) => {
        const startPoint = landmarks[startIdx];
        const endPoint = landmarks[endIdx];
        
        if (startPoint && endPoint && startPoint.visibility > 0.5 && endPoint.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(startPoint.x * canvas.width, startPoint.y * canvas.height);
            ctx.lineTo(endPoint.x * canvas.width, endPoint.y * canvas.height);
            ctx.stroke();
        }
    });
    
    // Рисуем ключевые точки
    landmarks.forEach((point, index) => {
        if (point.visibility > 0.5) {
            const x = point.x * canvas.width;
            const y = point.y * canvas.height;
            
            // Разные цвета для разных частей тела
            if (index >= 0 && index <= 10) { // Лицо
                ctx.fillStyle = '#ff00ff';
            } else if (index >= 11 && index <= 22) { // Руки и плечи
                ctx.fillStyle = index % 2 === 0 ? '#ff0000' : '#0000ff';
            } else { // Ноги и тело
                ctx.fillStyle = index % 2 === 0 ? '#ff9900' : '#00ccff';
            }
            
            ctx.beginPath();
            ctx.arc(x, y, 6, 0, Math.PI * 2);
            ctx.fill();
            
            // Обводка для лучшей видимости
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });
}

// Расчет угла между тремя точками
function calculateAngle(A, B, C) {
    if (!A || !B || !C) return 180;
    
    const AB = { x: B.x - A.x, y: B.y - A.y };
    const BC = { x: C.x - B.x, y: C.y - B.y };
    
    const dotProduct = AB.x * BC.x + AB.y * BC.y;
    const magAB = Math.sqrt(AB.x * AB.x + AB.y * AB.y);
    const magBC = Math.sqrt(BC.x * BC.x + BC.y * BC.y);
    
    if (magAB === 0 || magBC === 0) return 180;
    
    const cosAngle = dotProduct / (magAB * magBC);
    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    return angle * (180 / Math.PI);
}

// Определение упражнения
function detectExercise(landmarks, worldLandmarks) {
    if (!landmarks || landmarks.length < 33) return 'none';
    
    // Ключевые точки для анализа
    const points = {
        leftShoulder: landmarks[11],
        rightShoulder: landmarks[12],
        leftElbow: landmarks[13],
        rightElbow: landmarks[14],
        leftWrist: landmarks[15],
        rightWrist: landmarks[16],
        leftHip: landmarks[23],
        rightHip: landmarks[24],
        leftKnee: landmarks[25],
        rightKnee: landmarks[26],
        leftAnkle: landmarks[27],
        rightAnkle: landmarks[28]
    };
    
    // Проверяем видимость ключевых точек
    for (const point of Object.values(points)) {
        if (!point || point.visibility < 0.3) return 'none';
    }
    
    // Вычисляем углы
    const leftKneeAngle = calculateAngle(points.leftHip, points.leftKnee, points.leftAnkle);
    const rightKneeAngle = calculateAngle(points.rightHip, points.rightKnee, points.rightAnkle);
    const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
    const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);
    
    const leftElbowAngle = calculateAngle(points.leftShoulder, points.leftElbow, points.leftWrist);
    const rightElbowAngle = calculateAngle(points.rightShoulder, points.rightElbow, points.rightWrist);
    const avgElbowAngle = (leftElbowAngle + rightElbowAngle) / 2;
    
    const bodyAngle = calculateAngle(points.leftShoulder, points.leftHip, points.leftAnkle);
    
    // Определяем упражнение
    if (bodyAngle > 170 && avgKneeAngle > 160 && avgElbowAngle > 70 && avgElbowAngle < 110) {
        return 'plank';
    }
    
    if (kneeDiff > 50 && (leftKneeAngle < 100 || rightKneeAngle < 100)) {
        return 'lunges';
    }
    
    if (avgKneeAngle < 120 && kneeDiff < 30 && avgElbowAngle > 150) {
        return 'squats';
    }
    
    if (avgElbowAngle < 100 && bodyAngle < 150 && avgKneeAngle > 150) {
        return 'pushups';
    }
    
    return 'none';
}

// Обновление состояния упражнения
function updateExerciseState(exercise, landmarks) {
    if (exercise === 'none') return;
    
    // Если упражнение изменилось
    if (exercise !== state.exercise) {
        const now = Date.now();
        if (now - state.lastExerciseChange < 2000) return; // Защита от ложных срабатываний
        
        state.exercise = exercise;
        state.lastExerciseChange = now;
        state.repCount = 0;
        
        if (exercise === 'plank') {
            state.plankStart = Date.now();
        } else {
            state.plankStart = null;
        }
    }
    
    // Обновление счетчиков
    updateCounters(landmarks);
}

// Обновление счетчиков
function updateCounters(landmarks) {
    if (!landmarks) return;
    
    const points = {
        leftHip: landmarks[23],
        rightHip: landmarks[24],
        leftKnee: landmarks[25],
        rightKnee: landmarks[26],
        leftAnkle: landmarks[27],
        rightAnkle: landmarks[28],
        leftShoulder: landmarks[11],
        rightShoulder: landmarks[12],
        leftElbow: landmarks[13],
        rightElbow: landmarks[14],
        leftWrist: landmarks[15],
        rightWrist: landmarks[16]
    };
    
    switch (state.exercise) {
        case 'squats':
            const leftKneeAngle = calculateAngle(points.leftHip, points.leftKnee, points.leftAnkle);
            const rightKneeAngle = calculateAngle(points.rightHip, points.rightKnee, points.rightAnkle);
            
            if (state.squatState === 'up' && (leftKneeAngle < 100 || rightKneeAngle < 100)) {
                state.squatState = 'down';
            } else if (state.squatState === 'down' && leftKneeAngle > 160 && rightKneeAngle > 160) {
                state.squatState = 'up';
                state.repCount++;
            }
            break;
            
        case 'lunges':
            const leftKneeAngleL = calculateAngle(points.leftHip, points.leftKnee, points.leftAnkle);
            const rightKneeAngleL = calculateAngle(points.rightHip, points.rightKnee, points.rightAnkle);
            const kneeDiff = Math.abs(leftKneeAngleL - rightKneeAngleL);
            
            if (state.lungeState === 'up' && kneeDiff > 60) {
                state.lungeState = 'down';
            } else if (state.lungeState === 'down' && kneeDiff < 30) {
                state.lungeState = 'up';
                state.repCount++;
            }
            break;
            
        case 'plank':
            if (state.plankStart) {
                state.plankTime = Math.floor((Date.now() - state.plankStart) / 1000);
            }
            break;
            
        case 'pushups':
            const leftElbowAngle = calculateAngle(points.leftShoulder, points.leftElbow, points.leftWrist);
            const rightElbowAngle = calculateAngle(points.rightShoulder, points.rightElbow, points.rightWrist);
            
            if (state.pushupState === 'up' && (leftElbowAngle < 70 || rightElbowAngle < 70)) {
                state.pushupState = 'down';
            } else if (state.pushupState === 'down' && leftElbowAngle > 150 && rightElbowAngle > 150) {
                state.pushupState = 'up';
                state.repCount++;
            }
            break;
    }
}

// Обновление обратной связи
function updateFeedback() {
    if (state.exercise === 'none') {
        elements.feedback.textContent = 'Встаньте в кадр и начните выполнять упражнение';
        elements.feedback.style.color = '#ff9800';
        return;
    }
    
    const feedbacks = {
        squats: state.squatState === 'down' 
            ? 'Отлично! Теперь медленно поднимайтесь, держите спину прямой.'
            : 'Медленно опускайтесь, колени не должны выходить за носки.',
        
        lunges: state.lungeState === 'down'
            ? 'Хорошо! Теперь вернитесь в исходное положение.'
            : 'Сделайте шаг вперед, переднее колено под углом 90 градусов.',
        
        plank: `Держите планку! Прошло ${state.plankTime} секунд. Тело должно быть прямой линией.`,
        
        pushups: state.pushupState === 'down'
            ? 'Теперь отжимайтесь вверх! Локти близко к телу.'
            : 'Опускайтесь вниз до угла 90 градусов в локтях.',
    };
    
    elements.feedback.textContent = feedbacks[state.exercise] || 'Продолжайте упражнение!';
    elements.feedback.style.color = '#4caf50';
}

// Анализ фото
async function analyzePhoto() {
    if (!elements.photoUpload.files || elements.photoUpload.files.length === 0) {
        elements.feedback.textContent = 'Сначала выберите фото!';
        elements.feedback.style.color = '#f44336';
        return;
    }
    
    if (!poseLandmarker) {
        elements.feedback.textContent = 'Модель еще не загружена';
        return;
    }
    
    // Останавливаем камеру если активна
    if (isCameraActive) {
        stopCamera();
    }
    
    const file = elements.photoUpload.files[0];
    const img = new Image();
    
    img.onload = async function() {
        canvas.width = img.width;
        canvas.height = img.height;
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        try {
            elements.status.textContent = 'Анализ фото...';
            
            // Создаем изображение для MediaPipe
            const mpImage = new vision.Image(img, vision.ImageFormat.SRGB);
            
            // Детекция на фото
            const results = poseLandmarker.detect(mpImage);
            
            if (results.landmarks && results.landmarks.length > 0) {
                const landmarks = results.landmarks[0];
                
                // Рисуем скелет
                drawMediaPipeSkeleton(landmarks);
                
                // Определяем упражнение
                const exercise = detectExercise(landmarks);
                
                // Обновляем UI
                const exerciseNames = {
                    'squats': '🏋️ Приседания',
                    'lunges': '🦵 Выпады',
                    'plank': '🧍 Планка',
                    'pushups': '💪 Отжимания',
                    'none': '❓ Упражнение не определено'
                };
                
                state.exercise = exercise;
                state.confidence = results.landmarks[0].reduce((acc, point) => acc + (point.visibility || 0), 0) / results.landmarks[0].length;
                
                updateUI();
                
                if (exercise !== 'none') {
                    elements.feedback.textContent = `На фото обнаружено: ${exerciseNames[exercise]}`;
                    elements.feedback.style.color = '#4caf50';
                } else {
                    elements.feedback.textContent = 'Не удалось определить упражнение. Попробуйте другое фото.';
                    elements.feedback.style.color = '#ff9800';
                }
                
            } else {
                elements.feedback.textContent = 'Не удалось найти позу на фото';
                elements.feedback.style.color = '#f44336';
            }
            
            elements.status.textContent = 'Анализ завершен';
            
        } catch (error) {
            console.error('Ошибка анализа фото:', error);
            elements.feedback.textContent = 'Ошибка анализа фото';
            elements.feedback.style.color = '#f44336';
        }
    };
    
    img.onerror = function() {
        elements.feedback.textContent = 'Ошибка загрузки изображения';
        elements.feedback.style.color = '#f44336';
    };
    
    img.src = URL.createObjectURL(file);
}