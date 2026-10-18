# mzokov.github.io

Веб-игры, доступные по адресу https://mzokov.github.io/

## Структура

- `index.html` - главная страница с плитками игр
- `shared/config.js` - настройки сервера (проект Firebase). Пока он пуст, данные хранятся только в браузере
- `shared/hub.js` - общий аккаунт, вход, гостевой режим и кошелёк монет для всех игр
- `snake/` - Змейка
- `tetris/` - Тетрис

Каждая игра лежит в своей папке и состоит из одного файла `index.html`. Данные игроков хранятся в `localStorage` браузера под ключом `hub.v1` (общий для всех игр на этом адресе), поэтому аккаунт работает на одном устройстве и в одном браузере.

## Хранение аккаунтов на сервере (Firebase)

1. https://console.firebase.google.com - создать проект (аналитику можно отключить).
2. Build - Firestore Database - Create database (режим production, регион eur3 или ближайший).
3. Вкладка Rules, вставить и опубликовать:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /accounts/{id} {
      allow read, create, update: if request.resource == null || request.resource.data.json.size() < 200000;
      allow delete: if false;
    }
  }
}
```

4. Project settings - Your apps - Web (</>) - зарегистрировать - из `firebaseConfig` взять `projectId` и `apiKey`.
5. Вписать их в `shared/config.js`.

## Как добавить новую игру

1. Создать папку `имя-игры/` и положить в неё `index.html`.
2. На главной странице `index.html` скопировать блок `<a class="card" href="...">` и поменять ссылку, название и описание.
3. Подключить `<script src="../shared/config.js"></script>` и `<script src="../shared/hub.js"></script>` и использовать `Hub.user()`, `Hub.coins()`, `Hub.addCoins(n)`, `Hub.spend(n)`, `Hub.gameData('имя-игры', {...})`, `Hub.save()`, `Hub.offerSave()` (предложить гостю сохранить прогресс), `Hub.mountBar(элемент)` (кнопка входа и кошелёк).
4. Закоммитить в ветку `main`. Через минуту-две игра появится на сайте.
