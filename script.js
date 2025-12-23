// Глобальные переменные
let net = null;
let video = null;
let canvas = null;
let ctx = null;
let isCameraActive = false;
let stream = null;
let animationFrameId = null;

// Счетчики и состояние
let repCount = 0;
let plankTime = 0;
let plankStartTime = null;
let currentExercise = 'none';
let lastExerciseChange = Date.now();
let squatState = 'up'; // 'up' или 'down'
let lungeState = 'up';
let pushupState = 'up';

// Элементы DOM
let repCountEl, timerEl, feedbackEl, exerciseNameEl, confidenceEl;
let startButton, stopButton, resetButton, analyzePhotoButton, photoUpload, statusEl;

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async function() {
    console.log('DOM загружен');
    
    // Инициализация элементов DOM
    initializeDOMElements();
    
    // Загрузка модели TensorFlow.js PoseNet
    await loadModel();
    
    // Назначение обработчиков событий
    setupEventListeners();
});

function initializeDOMElements() {
    video = document.getElementById('webcam');
    canvas = document.getElementById('output_canvas');
    ctx = canvas.getContext('2d');
    
    repCountEl = document.getElementById('repCount');
    timerEl = document.getElementById('timer');
    feedbackEl = document.getElementById('feedback');
    exerciseNameEl = document.getElementById('exerciseName');
    confidenceEl = document.getElementById('confidence');
    statusEl = document.getElementById('status');
    
    startButton = document.getElementById('startButton');
    stopButton = document.getElementById('stopButton');
    resetButton = document.getElementById('resetButton');
    analyzePhotoButton = document.getElementById('analyzePhotoButton');
    photoUpload = document.getElementById('photoUpload');
}

async function loadModel() {
    try {
        feedbackEl.textContent = "Загрузка TensorFlow.js модели PoseNet...";
        feedbackEl.style.color = '#ffa502';
        
        console.log('Загрузка PoseNet модели...');
        
        // Загружаем модель PoseNet
        net = await posenet.load({
            architecture: 'MobileNetV1',
            outputStride: 16,
            inputResolution: { width: 640, height: 480 },
            multiplier: 0.75,
            quantBytes: 2
        });
        
        console.log('PoseNet модель загружена!');
        feedbackEl.textContent = "Модель загружена! Нажмите 'Включить камеру' или загрузите фото.";
        feedbackEl.style.color = '#38ef7d';
        statusEl.textContent = 'Модель готова';
        
    } catch (error) {
        console.error('Ошибка загрузки модели:', error);
        feedbackEl.textContent = "Ошибка загрузки модели. Проверьте консоль браузера.";
        feedbackEl.style.color = '#FF416C';
        statusEl.textContent = 'Ошибка загрузки модели';
    }
}

function setupEventListeners() {
    startButton.addEventListener('click', startCamera);
    stopButton.addEventListener('click', stopCamera);
    resetButton.addEventListener('click', resetCounters);
    analyzePhotoButton.addEventListener('click', analyzePhoto);
}

// Запуск камеры
async function startCamera() {
    console.log('Запуск камеры...');
    
    if (!net) {
        feedbackEl.textContent = "Модель еще загружается...";
        return;
    }
    
    // Останавливаем предыдущий стрим если есть
    if (stream) {
        stopCamera();
    }
    
    try {
        // Запрашиваем доступ к камере
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: {
                facingMode: "user",
                width: { ideal: 640 },
                height: { ideal: 480 },
                frameRate: { ideal: 30 }
            },
            audio: false
        });
        
        // Настраиваем видео элемент
        video.srcObject = stream;
        
        // Ждем загрузки метаданных
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
        resetCounters();
        
        feedbackEl.textContent = "Камера включена. Встаньте в кадр и начните упражнение.";
        feedbackEl.style.color = '#38ef7d';
        exerciseNameEl.textContent = 'Определение упражнения...';
        statusEl.textContent = 'Камера активна';
        
        console.log('Запускаем детекцию...');
        // Запускаем детекцию
        detectPose();
        
    } catch (error) {
        console.error('Ошибка камеры:', error);
        let errorMsg = "Ошибка доступа к камере: ";
        
        if (error.name === 'NotAllowedError') {
            errorMsg = "Доступ к камере запрещен. Разрешите доступ в настройках браузера.";
        } else if (error.name === 'NotFoundError') {
            errorMsg = "Камера не найдена. Убедитесь, что камера подключена.";
        } else if (error.name === 'NotReadableError') {
            errorMsg = "Камера уже используется другим приложением.";
        } else {
            errorMsg += error.message;
        }
        
        feedbackEl.textContent = errorMsg;
        feedbackEl.style.color = '#FF416C';
        statusEl.textContent = 'Ошибка камеры';
    }
}

// Остановка камеры
function stopCamera() {
    console.log('Остановка камеры...');
    
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
    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'white';
    ctx.font = '24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Камера выключена', canvas.width/2, canvas.height/2);
    
    // Обновляем UI
    startButton.style.display = 'inline-block';
    stopButton.style.display = 'none';
    
    feedbackEl.textContent = "Камера выключена. Можете загрузить фото для анализа.";
    feedbackEl.style.color = '#ffa502';
    exerciseNameEl.textContent = 'Камера выключена';
    statusEl.textContent = 'Камера выключена';
}

// Сброс счетчиков
function resetCounters() {
    repCount = 0;
    plankTime = 0;
    plankStartTime = null;
    currentExercise = 'none';
    lastExerciseChange = Date.now();
    squatState = 'up';
    lungeState = 'up';
    pushupState = 'up';
    
    repCountEl.textContent = '0';
    timerEl.textContent = '0 сек';
    confidenceEl.textContent = '0%';
    exerciseNameEl.textContent = 'Определение упражнения...';
    
    feedbackEl.textContent = "Счетчики сброшены. Готовы к новому упражнению!";
    feedbackEl.style.color = '#38ef7d';
}

// Основная функция детекции позы
async function detectPose() {
    if (!net || !isCameraActive) {
        return;
    }
    
    try {
        // Оцениваем позу
        const pose = await net.estimateSinglePose(video, {
            flipHorizontal: false,
            decodingMethod: 'single-person'
        });
        
        // Рисуем текущий кадр
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Рисуем скелет если найдены ключевые точки
        if (pose.score > 0.2) {
            drawSkeleton(pose);
            
            // Определяем упражнение
            const exercise = detectExerciseFromPose(pose);
            
            // Обновляем уверенность
            confidenceEl.textContent = `${Math.round(pose.score * 100)}%`;
            
            // Обновляем упражнение
            updateExercise(exercise, pose);
            
            // Обновляем обратную связь
            updateFeedback(pose);
        } else {
            feedbackEl.textContent = 'Стойте в кадре и убедитесь, что все тело видно';
            feedbackEl.style.color = '#ffa502';
            confidenceEl.textContent = '0%';
        }
        
        statusEl.textContent = `Детекция: ${pose.score > 0.2 ? 'Активна' : 'Нет позы'}`;
        
    } catch (error) {
        console.error('Ошибка детекции:', error);
        statusEl.textContent = 'Ошибка детекции';
    }
    
    // Продолжаем цикл если камера активна
    if (isCameraActive) {
        animationFrameId = requestAnimationFrame(detectPose);
    }
}

// Рисование скелета
function drawSkeleton(pose) {
    const keypoints = pose.keypoints;
    
    // Рисуем линии между соединениями
    const connections = [
        ['leftShoulder', 'rightShoulder'], // плечи
        ['leftShoulder', 'leftElbow'],
        ['leftElbow', 'leftWrist'],
        ['rightShoulder', 'rightElbow'],
        ['rightElbow', 'rightWrist'],
        ['leftShoulder', 'leftHip'],
        ['rightShoulder', 'rightHip'],
        ['leftHip', 'rightHip'],
        ['leftHip', 'leftKnee'],
        ['leftKnee', 'leftAnkle'],
        ['rightHip', 'rightKnee'],
        ['rightKnee', 'rightAnkle']
    ];
    
    // Рисуем соединения
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    
    connections.forEach(([start, end]) => {
        const startPoint = keypoints.find(kp => kp.part === start);
        const endPoint = keypoints.find(kp => kp.part === end);
        
        if (startPoint && endPoint && startPoint.score > 0.3 && endPoint.score > 0.3) {
            ctx.beginPath();
            ctx.moveTo(startPoint.position.x, startPoint.position.y);
            ctx.lineTo(endPoint.position.x, endPoint.position.y);
            ctx.stroke();
        }
    });
    
    // Рисуем ключевые точки
    keypoints.forEach(point => {
        if (point.score > 0.3) {
            ctx.fillStyle = point.part.includes('left') ? '#ff0000' : 
                           point.part.includes('right') ? '#0000ff' : '#ffff00';
            
            ctx.beginPath();
            ctx.arc(point.position.x, point.position.y, 6, 0, 2 * Math.PI);
            ctx.fill();
        }
    });
}

// Определение упражнения по позе
function detectExerciseFromPose(pose) {
    const keypoints = pose.keypoints;
    
    // Получаем нужные ключевые точки
    const leftHip = keypoints.find(kp => kp.part === 'leftHip');
    const rightHip = keypoints.find(kp => kp.part === 'rightHip');
    const leftKnee = keypoints.find(kp => kp.part === 'leftKnee');
    const rightKnee = keypoints.find(kp => kp.part === 'rightKnee');
    const leftAnkle = keypoints.find(kp => kp.part === 'leftAnkle');
    const rightAnkle = keypoints.find(kp => kp.part === 'rightAnkle');
    const leftShoulder = keypoints.find(kp => kp.part === 'leftShoulder');
    const rightShoulder = keypoints.find(kp => kp.part === 'rightShoulder');
    const leftElbow = keypoints.find(kp => kp.part === 'leftElbow');
    const rightElbow = keypoints.find(kp => kp.part === 'rightElbow');
    const leftWrist = keypoints.find(kp => kp.part === 'leftWrist');
    const rightWrist = keypoints.find(kp => kp.part === 'rightWrist');
    
    // Проверяем, что все необходимые точки видны
    const requiredPoints = [leftHip, rightHip, leftKnee, rightKnee];
    if (requiredPoints.some(p => !p || p.score < 0.3)) {
        return 'none';
    }
    
    // Вычисляем углы
    const leftKneeAngle = calculateAngle(leftHip.position, leftKnee.position, leftAnkle?.position || leftKnee.position);
    const rightKneeAngle = calculateAngle(rightHip.position, rightKnee.position, rightAnkle?.position || rightKnee.position);
    const avgKneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
    const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);
    
    // Угол тела (плечо-бедро-лодыжка)
    const bodyAngle = calculateAngle(
        leftShoulder?.position || leftHip.position,
        leftHip.position,
        leftAnkle?.position || leftKnee.position
    );
    
    // Проверка на планку
    if (bodyAngle > 160 && avgKneeAngle > 150) {
        return 'plank';
    }
    
    // Проверка на выпады
    if (kneeDiff > 40 && (leftKneeAngle < 120 || rightKneeAngle < 120)) {
        return 'lunges';
    }
    
    // Проверка на приседания
    if (avgKneeAngle < 120 && kneeDiff < 30) {
        return 'squats';
    }
    
    // Проверка на отжимания
    if (leftElbow && rightElbow && leftWrist && rightWrist) {
        const leftElbowAngle = calculateAngle(leftShoulder.position, leftElbow.position, leftWrist.position);
        const rightElbowAngle = calculateAngle(rightShoulder.position, rightElbow.position, rightWrist.position);
        const avgElbowAngle = (leftElbowAngle + rightElbowAngle) / 2;
        
        if (avgElbowAngle < 100 && bodyAngle < 150) {
            return 'pushups';
        }
    }
    
    return 'none';
}

// Расчет угла между тремя точками
function calculateAngle(a, b, c) {
    const ab = Math.sqrt(Math.pow(b.x - a.x, 2) + Math.pow(b.y - a.y, 2));
    const bc = Math.sqrt(Math.pow(b.x - c.x, 2) + Math.pow(b.y - c.y, 2));
    const ac = Math.sqrt(Math.pow(c.x - a.x, 2) + Math.pow(c.y - a.y, 2));
    
    if (ab === 0 || bc === 0) return 180;
    
    const angle = Math.acos((Math.pow(ab, 2) + Math.pow(bc, 2) - Math.pow(ac, 2)) / (2 * ab * bc));
    return angle * (180 / Math.PI);
}

// Обновление упражнения
function updateExercise(exercise, pose) {
    if (exercise === 'none') return;
    
    // Если упражнение изменилось
    if (exercise !== currentExercise) {
        // Минимальное время между сменами упражнений (2 секунды)
        if (Date.now() - lastExerciseChange < 2000) return;
        
        currentExercise = exercise;
        lastExerciseChange = Date.now();
        
        // Обновляем название упражнения
        const exerciseNames = {
            'squats': '🏋️ Приседания',
            'lunges': '🦵 Выпады',
            'plank': '🧍 Планка',
            'pushups': '💪 Отжимания'
        };
        
        exerciseNameEl.textContent = exerciseNames[exercise] || 'Упражнение';
        
        // Сброс счетчиков при смене упражнения
        if (exercise === 'plank') {
            plankStartTime = Date.now();
        } else {
            plankStartTime = null;
        }
    }
    
    // Обновление счетчиков
    updateCounters(exercise, pose);
}

// Обновление счетчиков
function updateCounters(exercise, pose) {
    const keypoints = pose.keypoints;
    const leftKnee = keypoints.find(kp => kp.part === 'leftKnee');
    const rightKnee = keypoints.find(kp => kp.part === 'rightKnee');
    
    if (!leftKnee || !rightKnee) return;
    
    const leftKneeAngle = calculateAngle(
        keypoints.find(kp => kp.part === 'leftHip').position,
        leftKnee.position,
        keypoints.find(kp => kp.part === 'leftAnkle')?.position || leftKnee.position
    );
    
    const rightKneeAngle = calculateAngle(
        keypoints.find(kp => kp.part === 'rightHip').position,
        rightKnee.position,
        keypoints.find(kp => kp.part === 'rightAnkle')?.position || rightKnee.position
    );
    
    switch (exercise) {
        case 'squats':
            if (squatState === 'up' && (leftKneeAngle < 90 || rightKneeAngle < 90)) {
                squatState = 'down';
            } else if (squatState === 'down' && leftKneeAngle > 160 && rightKneeAngle > 160) {
                squatState = 'up';
                repCount++;
                repCountEl.textContent = repCount;
            }
            break;
            
        case 'lunges':
            const kneeDiff = Math.abs(leftKneeAngle - rightKneeAngle);
            if (lungeState === 'up' && kneeDiff > 60) {
                lungeState = 'down';
            } else if (lungeState === 'down' && kneeDiff < 30) {
                lungeState = 'up';
                repCount++;
                repCountEl.textContent = repCount;
            }
            break;
            
        case 'plank':
            if (plankStartTime) {
                plankTime = Math.floor((Date.now() - plankStartTime) / 1000);
                timerEl.textContent = `${plankTime} сек`;
            }
            break;
            
        case 'pushups':
            const leftElbow = keypoints.find(kp => kp.part === 'leftElbow');
            const rightElbow = keypoints.find(kp => kp.part === 'rightElbow');
            
            if (leftElbow && rightElbow) {
                const leftShoulder = keypoints.find(kp => kp.part === 'leftShoulder');
                const rightShoulder = keypoints.find(kp => kp.part === 'rightShoulder');
                const leftWrist = keypoints.find(kp => kp.part === 'leftWrist');
                const rightWrist = keypoints.find(kp => kp.part === 'rightWrist');
                
                if (leftShoulder && rightShoulder && leftWrist && rightWrist) {
                    const leftElbowAngle = calculateAngle(
                        leftShoulder.position,
                        leftElbow.position,
                        leftWrist.position
                    );
                    const rightElbowAngle = calculateAngle(
                        rightShoulder.position,
                        rightElbow.position,
                        rightWrist.position
                    );
                    
                    if (pushupState === 'up' && (leftElbowAngle < 70 || rightElbowAngle < 70)) {
                        pushupState = 'down';
                    } else if (pushupState === 'down' && leftElbowAngle > 150 && rightElbowAngle > 150) {
                        pushupState = 'up';
                        repCount++;
                        repCountEl.textContent = repCount;
                    }
                }
            }
            break;
    }
}

// Обновление обратной связи
function updateFeedback(pose) {
    if (currentExercise === 'none') {
        feedbackEl.textContent = 'Встаньте в кадр и начните выполнять упражнение';
        feedbackEl.style.color = '#ffa502';
        return;
    }
    
    const feedbackMessages = {
        'squats': squatState === 'down' ? 
            'Отлично! Теперь медленно поднимайтесь' : 
            'Медленно опускайтесь, держите спину прямой',
        
        'lunges': lungeState === 'down' ?
            'Хорошо! Теперь вернитесь в исходное положение' :
            'Сделайте шаг вперед, согните колено',
        
        'plank': `Держите планку! Прошло ${plankTime} секунд. Тело прямо!`,
        
        'pushups': pushupState === 'down' ?
            'Теперь отжимайтесь вверх!' :
            'Опускайтесь вниз, локти близко к телу',
        
        'none': 'Выполняйте упражнение четко перед камерой'
    };
    
    feedbackEl.textContent = feedbackMessages[currentExercise] || 'Продолжайте упражнение';
    feedbackEl.style.color = '#38ef7d';
}

// Анализ фото
async function analyzePhoto() {
    if (!photoUpload.files || photoUpload.files.length === 0) {
        feedbackEl.textContent = 'Сначала выберите фото!';
        feedbackEl.style.color = '#FF416C';
        return;
    }
    
    if (!net) {
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
    
    img.onload = async function() {
        // Устанавливаем размер canvas под фото
        canvas.width = img.width;
        canvas.height = img.height;
        
        // Рисуем фото на canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        
        try {
            // Анализируем позу на фото
            const pose = await net.estimateSinglePose(img, {
                flipHorizontal: false,
                decodingMethod: 'single-person'
            });
            
            if (pose.score > 0.2) {
                // Рисуем скелет
                drawSkeleton(pose);
                
                // Определяем упражнение
                const exercise = detectExerciseFromPose(pose);
                
                // Обновляем UI
                const exerciseNames = {
                    'squats': '🏋️ Приседания',
                    'lunges': '🦵 Выпады',
                    'plank': '🧍 Планка',
                    'pushups': '💪 Отжимания',
                    'none': '❓ Упражнение не определено'
                };
                
                exerciseNameEl.textContent = exerciseNames[exercise];
                confidenceEl.textContent = `${Math.round(pose.score * 100)}%`;
                
                if (exercise !== 'none') {
                    feedbackEl.textContent = `На фото обнаружено: ${exerciseNames[exercise].split(' ')[1]}`;
                    feedbackEl.style.color = '#38ef7d';
                } else {
                    feedbackEl.textContent = 'Не удалось определить упражнение на фото';
                    feedbackEl.style.color = '#ffa502';
                }
                
            } else {
                feedbackEl.textContent = 'Не удалось найти позу на фото';
                feedbackEl.style.color = '#FF416C';
                exerciseNameEl.textContent = 'Поза не найдена';
                confidenceEl.textContent = '0%';
            }
            
        } catch (error) {
            console.error('Ошибка анализа фото:', error);
            feedbackEl.textContent = 'Ошибка анализа фото';
            feedbackEl.style.color = '#FF416C';
        }
    };
    
    img.onerror = function() {
        feedbackEl.textContent = 'Ошибка загрузки изображения';
        feedbackEl.style.color = '#FF416C';
    };
    
    img.src = URL.createObjectURL(file);
}