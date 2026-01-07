---
description: Kompletná údržba dát (Scraping -> Scoring -> Cleanup -> Deploy)
---

// turbo-all

Táto workflow zabezpečuje kompletný cyklus aktualizácie dát bez potreby manuálneho potvrdzovania každého kroku.

1. Spustiť hlavný proces vyhľadávania a analýzy
```powershell
node scraper_agent.js --once; node autobazar_sk_agent.js; node autobazar_eu_agent.js; node autovia_agent.js; node market_value_agent.js; node scoring_agent.js; node cleaner_agent.js
```

2. Odoslať zmeny na server a nasadiť dashboard
```powershell
git add . ; git commit -m "Auto-maintenance: Full update cycle"; git push
```
