# Напредък (FinBridge)

- [x] Lead agent (`lead-agent/`), слят в `main`
- [x] CSP без `'unsafe-inline'` за скриптове
- [x] Шрифтове на собствения сървър
- [x] `GET /api/fin/state` без записи; `POST /api/fin/refresh`
- [x] Двуфакторен вход (TOTP) с вход, включване, изключване, `admin.js disable-2fa`
- [x] Журнал на действията и страница „Сигурност и журнал“
- [x] Изпращане на фактури и кредитни известия по имейл
- [x] README, AUDIT.md, DECISIONS.md, TODO.md
- [x] Тестове: `npm test` и `npm run test:e2e` минават, включително новите `api7` и `e2e-security`
- [ ] Публикуване онлайн (сливане в `main`; Render настройва собственикът)
