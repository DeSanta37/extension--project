const levelNames = {
    '1': 'Лёгкий',
    '2': 'Стандарт',
    '3': 'Глубокий'
};

const levelDescriptions = {
    1: {
        title: 'Уровень 1: Лёгкий',
        description: 'Максимально упрощённый вариант для быстрого понимания материала. Подходит для студентов 1-2 курса, которые только начинают знакомиться с медицинской терминологией.',
        features: [
            'Сложные термины заменены на простые аналоги',
            'Длинные предложения разбиты на короткие',
            'Добавлены пояснения к ключевым понятиям',
            'Убраны второстепенные детали',
            'Акцент на основных фактах и выводах'
        ]
    },
    2: {
        title: 'Уровень 2: Стандарт',
        description: 'Баланс между точностью и доступностью. Терминология сохранена, но дополнена краткими пояснениями. Рекомендуется для студентов 3-4 курса.',
        features: [
            'Профессиональные термины сохранены с пояснениями',
            'Улучшена логическая структура текста',
            'Выделены ключевые взаимосвязи',
            'Сохранены важные клинические детали',
            'Оптимально для подготовки к экзаменам'
        ]
    },
    3: {
        title: 'Уровень 3: Глубокий',
        description: 'Полное сохранение профессиональной лексики с улучшением читаемости. Для старшекурсников и ординаторов, которым важна точность без потери деталей.',
        features: [
            'Вся профессиональная терминология сохранена',
            'Улучшена структура и навигация по тексту',
            'Добавлены логические связки и переходы',
            'Подчеркнуты причинно-следственные связи',
            'Подходит для клинической практики и исследований'
        ]
    }
};

function showScreen(screenNum) {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    if (screenNum === 3) {
        document.getElementById('screen-3').classList.add('active');
    } else {
        document.getElementById(`screen-${screenNum}`).classList.add('active');
    }
    
    document.querySelectorAll('.nav-item')[screenNum - 1].classList.add('active');
}

function startLoading() {
    const selectedLevel = document.querySelector('input[name="level"]:checked').value;
    const levelName = levelNames[selectedLevel];
    
    document.getElementById('selected-level').textContent = levelName;
    
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.getElementById('screen-loading').classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-item')[2].classList.add('active');

    setTimeout(() => {
        document.getElementById('screen-loading').classList.remove('active');
        document.getElementById('screen-3').classList.add('active');
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-item')[2].classList.add('active');
    }, 2000);
}

function openModal(levelNum) {
    const level = levelDescriptions[levelNum];
    const modalBody = document.getElementById('modal-body');
    
    let featuresHTML = level.features.map(f => `<li>${f}</li>`).join('');
    
    modalBody.innerHTML = `
        <div class="modal-title">${level.title}</div>
        <div class="modal-description">${level.description}</div>
        <ul class="modal-features">${featuresHTML}</ul>
    `;
    
    document.getElementById('modal-overlay').classList.add('active');
}

function closeModal(event) {
    if (!event || event.target === document.getElementById('modal-overlay')) {
        document.getElementById('modal-overlay').classList.remove('active');
    }
}

// Функции для модального окна адаптации
function openAdaptModal() {
    document.getElementById('adaptModal').classList.add('active');
}

function closeAdaptModal(event) {
    if (!event || event.target === document.getElementById('adaptModal')) {
        document.getElementById('adaptModal').classList.remove('active');
    }
}

// Функции для плавающей кнопки помощи
function toggleHelpTooltip() {
    const tooltip = document.getElementById('helpTooltip');
    tooltip.classList.toggle('active');
}

// Закрытие подсказки при клике вне её
document.addEventListener('click', function(event) {
    const tooltip = document.getElementById('helpTooltip');
    const helpButton = document.querySelector('.help-button');
    
    if (!tooltip.contains(event.target) && !helpButton.contains(event.target)) {
        tooltip.classList.remove('active');
    }
});

// Функции для модального окна с описанием уровней
function showLevelDescription(levelNum) {
    const modal = document.getElementById('helpLevelsModal');
    const content = document.getElementById('helpLevelsContent');
    const level = levelDescriptions[levelNum];
    
    content.innerHTML = `
        <div class="help-level-item">
            <div class="help-level-item-title" style="font-size: 15px; margin-bottom: 12px;">${level.title}</div>
            <div class="help-level-item-desc" style="font-size: 12px; line-height: 1.6; margin-bottom: 12px;">${level.description}</div>
            <ul class="help-level-item-features">
                ${level.features.map(f => `<li>${f}</li>`).join('')}
            </ul>
        </div>
    `;
    
    modal.classList.add('active');
    document.getElementById('helpTooltip').classList.remove('active');
}

function closeHelpLevelsModal(event) {
    if (!event || event.target === document.getElementById('helpLevelsModal')) {
        document.getElementById('helpLevelsModal').classList.remove('active');
    }
}

function toggleColorBox(element) {
    const colorBox = document.getElementById('colorBox');
    colorBox.classList.toggle('active');
}

function updateCharCounter(text) {
    const charCount = document.getElementById('char-count');
    if (text && text.length > 0) {
        charCount.textContent = `${text.length} символов`;
    } else {
        charCount.textContent = '340 символов';
    }
}