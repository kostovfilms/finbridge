# Lead agent — заявки за клиенти

Локален агент за **Media Productions 2000** и **Media Digital**. Работи само на вашия компютър (macOS или Windows) с вашия вход във Facebook, Instagram и LinkedIn. Намира публикации, в които някой **търси** видео услуга (България) или 3D/CGI услуга (САЩ), и ги събира в таблица.

**Агентът само чете.** Не пише, не коментира, не харесва, не праща съобщения, не се присъединява към групи и не плаща. Единственото, което натиска, е „Виж още“ в дълга публикация. Това е проверено с автоматичен тест (`tests/safety.test.ts`).

## Какво прави

1. Обхожда източниците един по един, с паузи от 5 до 20 секунди и плавно скролване:
   - **Facebook**: групите, в които сте член (списък в `config.yaml`), и търсене на публикации по ключови думи (най-новите);
   - **LinkedIn**: търсене на публикации по ключови думи, сортирани по дата;
   - **Instagram**: хаштаговете от конфигурацията;
   - **Upwork**: RSS адреси, ако имате (вижте „Ограничения“);
   - **Форуми и обяви**: публични RSS/Atom или HTML страници без вход (например Reddit).
2. Оставя само **търсещите** („търся“, „нужен ми е“, „looking for“, „need“). Махат се предлагащите („предлагам“, „търся работа“, „for hire“, „my portfolio“).
3. За всяка заявка записва дата, източник, пазар, ниша, град или държава, нуждата в 1–2 изречения, връзка и автор (само ако е видим публично).
4. Маха дубликатите по адрес и по сходен текст.
5. Записва `output/leads.csv` и `output/leads.xlsx`, с най-новите отгоре.

С ключ за Claude API класификацията се прави от Claude, иначе по ключови думи. Телефоните и имейлите в текста се заменят с `[телефон]` и `[имейл]`. Записите се трият след 90 дни.

## Инсталиране

Нужен е [Node.js](https://nodejs.org) 20 или по-нов.

```bash
cd lead-agent
npm install
npm run setup
```

`npm run setup` сваля браузъра Chromium за Playwright (около 150 MB, еднократно).

По желание, за класификация с Claude:

```bash
cp .env.example .env
```

После отворете `.env` и попълнете `ANTHROPIC_API_KEY=`. Без ключ всичко работи, но класификацията е по ключови думи.

## Първи вход

```bash
npm run login
```

Отваря се видим Chromium с три раздела: Facebook, Instagram и LinkedIn.

1. Влезте ръчно във всеки (с 2FA, ако се иска).
2. Затворете целия прозорец.

Сесиите остават в папката `browser-profile/`. Агентът не вижда и не пази паролите ви: там са само бисквитките, както в обикновен браузър. Пазете тази папка като парола и не я качвайте никъде (в `.gitignore` е).

Ако някоя сесия изтече, агентът пише в лога „нужен е нов вход“, пропуска този източник и продължава с другите. Таблото също го показва. Пуснете `npm run login` отново.

При captcha или проверка за сигурност агентът пропуска източника. Не я заобикаля. Влезте ръчно с `npm run login` и решете проверката сами.

## Настройка

Всичко е в `config.yaml`, без код:

- `markets`: пазарите, заявките за търсене (`searchQueries`) и нишите с ключовите думи. Редът на нишите има значение: първата със съвпадение печели, затова общите са накрая.
- `seekerPhrases` и `offerPhrases`: фразите за „търси“ и „предлага“.
- `sources.facebook.groups`: адресите на групите, в които **вече сте член**, например `https://www.facebook.com/groups/1234567890`.
- `sources.instagram.hashtags`, `sources.forums.feeds`, `sources.upwork.feeds`.
- `limits`: до 30 групи и до 200 публикации на пускане, паузи 5–20 с, `maxSearchesPerSource` търсения на източник на пускане. Заявките се въртят: всяко пускане продължава оттам, където е спряло предишното.
- `schedule`: на колко часа (по подразбиране 6) и работни часове (09:00–21:00).
- `browser.headless`: `false` (видим прозорец) е по-безопасно срещу блокиране.
- `llm`, `privacy`, `notifications.dailySummary` (известие на компютъра веднъж на ден).

## Пускане

```bash
npm run check
```

**Ръчна проверка:** 1 група и 1 търсене на източник, видим браузър, най-много 40 публикации. Накрая показва кой източник как е минал. Може и само за някои източници: `npm run check -- facebook linkedin`. Направете я след първия вход.

```bash
npm run start
```

Едно пълно пускане. Работи по всяко време; работните часове важат само за графика.

```bash
npm run dashboard
```

Табло на http://localhost:3000 с филтри по пазар, ниша, източник, дата и текст, бутон „Отвори публикацията“ и сваляне на CSV/Excel. Таблото е достъпно само от този компютър.

```bash
npm run schedule
```

Работи на фона и пуска агента на всеки N часа (по подразбиране 6), само в работните часове. Ако компютърът е спал, пропуснатото пускане не се наваксва: следващото е по графика. Спиране: Ctrl+C. Промените в `config.yaml` важат от следващото пускане.

Логовете са в `logs/ГГГГ-ММ-ДД.log`. Резултатът от последното пускане е в `output/last-run.json`.

## Автоматично стартиране при включване

### macOS (launchd)

1. Намерете пътищата: `which npm` (например `/opt/homebrew/bin/npm`) и `pwd` в папката `lead-agent`.
2. Създайте файла `~/Library/LaunchAgents/bg.media.leadagent.plist` (заменете двата пътя):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>bg.media.leadagent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/homebrew/bin/npm</string>
    <string>run</string>
    <string>schedule</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/ВАШЕТО_ИМЕ/lead-agent</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/ВАШЕТО_ИМЕ/lead-agent/logs/launchd.log</string>
  <key>StandardErrorPath</key><string>/Users/ВАШЕТО_ИМЕ/lead-agent/logs/launchd.log</string>
</dict>
</plist>
```

3. Включете го:

```bash
launchctl load ~/Library/LaunchAgents/bg.media.leadagent.plist
```

Спиране:

```bash
launchctl unload ~/Library/LaunchAgents/bg.media.leadagent.plist
```

### Windows (Task Scheduler)

1. Отворете **Task Scheduler** → **Create Task**.
2. **General**: име `Lead agent`, отметнете **Run only when user is logged on** (нужен е видим браузър).
3. **Triggers** → **New** → **At log on**.
4. **Actions** → **New** → **Start a program**:
   - Program: `cmd.exe`
   - Arguments: `/c npm run schedule >> logs\scheduler.log 2>&1`
   - Start in: пълният път до папката `lead-agent`, например `C:\Users\ВАШЕТО_ИМЕ\lead-agent`
5. **Settings**: махнете отметката **Stop the task if it runs longer than**.

Или от командния ред (cmd), в папката `lead-agent`:

```bat
schtasks /Create /TN "Lead agent" /SC ONLOGON /TR "cmd.exe /c cd /d \"%CD%\" && npm run schedule >> logs\scheduler.log 2>&1"
```

## Поправка на селектори

Facebook, LinkedIn и Instagram сменят HTML често. Ако `npm run check` показва 0 публикации от източник, който работи в браузъра:

1. Отворете `src/selectors/facebook.ts` (или `linkedin.ts`, `instagram.ts`).
2. В Chrome натиснете с десен бутон върху публикация → **Inspect** и вижте какъв елемент я обвива.
3. Сменете съответния селектор (`post`, `text`, `author`, `permalink`) и пуснете `npm run check -- facebook`.

Логиката не се пипа: всички селектори за един сайт са в един файл.

## Сигурност и лични данни

- Всичко е локално: `browser-profile/`, `.env`, `output/` и `logs/` са в `.gitignore`.
- Към облака отива само заявката към Claude API, ако е включена. В нея са текстовете на публикациите **без** телефони и имейли, без имена на автори и адреси.
- Телефоните и имейлите в текста се заменят. Ако ви трябват (публикувани са в самата заявка), сложете `privacy.keepContactsFromPost: true`.
- Записите по-стари от `privacy.retentionDays` (90) се трият при всяко пускане.
- Таблото слуша само на 127.0.0.1.

**Важно:** условията на Facebook, Instagram и LinkedIn забраняват автоматизирано събиране на данни, дори само четене от собствен профил. Паузите и лимитите намаляват риска, но профилът все пак може да бъде ограничен. Започнете с по-ниски лимити (например `maxGroups: 10`, `maxPostsPerRun: 50`, `everyHours: 12`) и ги вдигайте постепенно.

## Разработка

```bash
npm test
```

Тестове (Vitest): филтър, дубликати, експорт, класификация, извличане от примерни страници в Chromium, източници, табло, пускане с грешки в източниците, и тест, че няма действия, които пишат в сайт.

```bash
npm run typecheck
```

```bash
npm run lint
```

Структура:

```
config.yaml            настройки
src/login.ts           ръчен вход
src/run.ts             едно пускане
src/check.ts           ръчна проверка
src/scheduler.ts       график
src/sources/*.ts       източниците
src/selectors/*.ts     селекторите за всеки сайт
src/filter.ts          търсещ/предлагащ, ниша, място
src/classify.ts        Claude или ключови думи
src/dedupe.ts          дубликати
src/export.ts          CSV и Excel
dashboard/             локално табло (Express)
output/  logs/         резултати и логове
```

Решенията са в [DECISIONS.md](DECISIONS.md), а отвореното — в [TODO.md](TODO.md).
