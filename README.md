# BazosBot

🤖 Automatizovaný systém pre monitorovanie a analýzu automobilového trhu na Bazos.sk s Telegram notifikáciami.

## Features

- 🔄 Periodické scrapovanie (60-120s náhodné intervaly)
- 🛡️ Anti-bot detection (Stealth plugin, UA rotation, Referer rotation)
- 📊 Market value analysis (mediánové ceny)
- 🌟 GOLDEN DEAL detekcia (15%+ zľavy)
- 📱 Telegram notifikácie
- 🐳 Docker support
- ⚙️ GitHub Actions automation

## Quick Start

### Lokálne spustenie

```bash
# Inštalácia
npm install

# Konfigurácia
cp .env.example .env
# Vyplň TELEGRAM_BOT_TOKEN a TELEGRAM_CHAT_ID

# Spustenie
node scraper_agent.js      # Continuous scraping
node market_value_agent.js  # Analyze prices
node scoring_agent.js       # Find deals
```

### Docker

```bash
# Build
docker build -t bazosbot .

# Run
docker run -d \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e TELEGRAM_CHAT_ID=your_chat_id \
  -v $(pwd)/data:/app/data \
  bazosbot
```

### GitHub Actions

1. Fork repository
2. Add secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
3. Enable Actions
4. Beží každé 2 hodiny automaticky

## Documentation

- [Telegram Setup](TELEGRAM_SETUP.md)
- [Deployment Guide](DEPLOY.md)
- [Full Walkthrough](walkthrough.md)

## License

MIT
