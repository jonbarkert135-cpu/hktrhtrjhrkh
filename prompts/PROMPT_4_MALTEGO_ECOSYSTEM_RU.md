# PROMPT 4

# MALTEGO ECOSYSTEM AUDIT + TRANSFORM / CONNECTOR SYSTEM + ADVANCED RESEARCH CAPABILITIES

Этот документ является **ЧЕТВЁРТЫМ ЭТАПОМ** развития проекта NEXUS.

Это НЕ исправление предыдущей архитектуры.

Это НЕ замена предыдущих MASTER PROMPT.

Это дополнительный слой функциональности поверх уже созданной системы.

Предыдущие архитектурные решения сохраняются:

- Local-First;
- Optional Backend;
- Infinite Canvas;
- Knowledge Graph;
- Documentation Map;
- Query Engine;
- Service Orchestrator;
- Engine Registry;
- Plugin Architecture;
- Capability Graph;
- Graph Visualization;
- Entity Resolution;
- Evidence Layer;
- AI Research Agent;
- Hidden Cloud compatibility.

Теперь необходимо добавить ещё один большой слой:

# MALTEGO-INSPIRED ECOSYSTEM / TRANSFORM SYSTEM

---

# 1. ГЛАВНАЯ ЦЕЛЬ

Проведи глубокий аудит современной экосистемы Maltego и используй его как один из главных архитектурных reference points для расширения NEXUS.

Официальная платформа Maltego сейчас включает Graph, Search, Monitor, Evidence и Data, а Data Hub предоставляет большое количество интеграций с внешними источниками и категориями данных.

Но:

# НЕ СОЗДАВАЙ КОПИЮ MALTEGO.

NEXUS должен взять только полезные:

- capabilities;
- workflows;
- concepts;
- integration patterns;
- transform concepts;
- entity relationships;
- data-source orchestration;
- investigation UX ideas;

и реализовать их в собственной архитектуре NEXUS.

---

# 2. КРИТИЧЕСКОЕ ПРАВИЛО

НЕ копируй:

- proprietary code;
- закрытые компоненты;
- внутренние алгоритмы;
- private APIs;
- приватные сервисы;
- обходы ограничений;
- чужой UI один-в-один;
- фирменный дизайн;
- закрытые transform implementations.

Не пытайся клонировать Maltego.

Вместо этого:

```text
Research
   ↓
Understand
   ↓
Classify
   ↓
Extract capability
   ↓
Evaluate usefulness
   ↓
Design NEXUS-native implementation
   ↓
Integrate
```

---

# 3. ОСНОВНАЯ ИДЕЯ

В NEXUS должна появиться собственная система:

# TRANSFORMS

Transform — это операция, которая принимает одну или несколько сущностей и возвращает новые сущности / relationships / evidence.

Например:

```text
Username
   ↓
Username Discovery Transform
   ↓
Websites
```

или:

```text
Domain
   ↓
DNS Transform
   ↓
DNS Records
```

или:

```text
Repository
   ↓
Repository Analysis Transform
   ↓
Languages
Dependencies
Contributors
Files
Releases
```

---

# 4. TRANSFORM ≠ ENGINE

Это принципиально важно.

**Engine** — реализация capability.

**Transform** — пользовательская операция.

Например:

```text
Transform:
"Find related websites"

Engine:
Sherlock
```

Другой Transform:

```text
Transform:
"Find related websites"

Engine:
Alternative Username Engine
```

Таким образом Transform остаётся стабильным, а engine можно заменять.

---

# 5. CAPABILITY-FIRST ARCHITECTURE

Архитектура должна выглядеть:

```text
User
 ↓
Transform
 ↓
Capability
 ↓
Best Available Engine
 ↓
Execution
 ↓
Normalized Results
 ↓
Entities
 ↓
Relationships
```

Это полностью соответствует предыдущему capability-first подходу.

---

# 6. UNIVERSAL TRANSFORM REGISTRY

Создай:

# Transform Registry

Каждый Transform должен иметь:

- id;
- name;
- description;
- category;
- input entity types;
- output entity types;
- capability;
- engines;
- permissions;
- execution mode;
- local compatibility;
- Hidden Cloud compatibility;
- API requirements;
- authentication requirements;
- rate limits;
- resource requirements;
- expected runtime;
- result quality;
- confidence;
- cacheability;
- documentation;
- status;
- version.

---

# 7. TRANSFORM MANIFEST

Создай единый manifest format.

Например:

```json
{
  "id": "domain-to-dns",
  "name": "Discover DNS Records",
  "inputs": ["domain"],
  "outputs": ["dns_record", "hostname", "ip"],
  "capability": "dns_discovery",
  "execution": {
    "mode": "local"
  },
  "requirements": {},
  "limits": {},
  "permissions": [],
  "fallbacks": []
}
```

Но если существует более правильный формат — предложи собственный.

---

# 8. CONTEXTUAL TRANSFORM MENU

При выборе Node пользователь должен видеть:

# Available Actions

Но не огромный список из 100 пунктов.

AI и Capability Engine должны показывать только релевантные операции.

Например:

## Для Username

- Discover related public profiles
- Search repositories
- Search web mentions
- Find related domains
- Expand identity graph
- Search documentation

## Для Domain

- DNS information
- Certificate information
- Archive references
- Related infrastructure
- Search public references
- Repository references

## Для Repository

- Analyze repository
- Analyze dependencies
- Find releases
- Inspect structure
- Find related repositories
- Build repository graph

---

# 9. "RUN"

У Transform должна быть основная кнопка:

# Run

Но рядом:

### Preview

Показывает:

- что будет выполнено;
- какие engines будут использоваться;
- какие данные будут отправлены;
- какие ограничения существуют.

---

# 10. AUTO-ENGINE SELECTION

Пользователь НЕ должен самостоятельно выбирать:

Sherlock / Engine X / Engine Y.

Он говорит:

> Find related public profiles.

NEXUS определяет:

```text
Capability:
Public profile discovery

Available engines:
Sherlock
Engine B
Engine C

Best combination:
Sherlock + Engine B
```

---

# 11. RUN ALL COMPATIBLE

Добавь:

# Run Compatible

Это не значит запускать вообще всё существующее.

Система должна:

1. определить совместимые engines;
2. исключить duplicate capabilities;
3. проверить availability;
4. проверить resource budget;
5. проверить API limits;
6. проверить permissions;
7. запустить оптимальную комбинацию.

---

# 12. SMART EXECUTION STRATEGY

Разделять engines на:

### Fast

быстрые локальные операции.

### Standard

обычные внешние запросы.

### Deep

дорогие по времени/ресурсам операции.

### Optional

низкоприоритетные расширения.

---

# 13. PARALLEL TRANSFORMS

Независимые transforms должны выполняться параллельно.

Например:

```text
             Username
          /      |       \
         /       |        \
    Engine A  Engine B  Engine C
         \       |        /
          \      |       /
           Result Aggregator
```

---

# 14. DEPENDENT TRANSFORMS

Если Transform B зависит от результата Transform A:

```text
A
↓
B
↓
C
```

Оркестратор должен строить DAG.

---

# 15. MALTEGO TRANSFORM HUB AUDIT

Проведи актуальное исследование официального Maltego Transform Hub.

Не ориентируйся на старые статьи.

Проверь:

- текущие data categories;
- integrations;
- public/free options;
- community options;
- local options;
- API-based options;
- paid-only options;
- OAuth options;
- deprecated options;
- currently maintained options.

На текущей странице Data Hub перечислены категории вроде infrastructure/network information, company data, personal identifiers, cryptocurrency, recon, vulnerabilities, social media, web/image content и другие, а среди источников есть как коммерческие providers, так и публичные/бесплатные источники.

---

# 16. НЕ ПЕРЕНОСИ ВСЁ СЛЕПО

Это одно из главных требований.

Ты НЕ должен делать:

> Maltego имеет 100+ integrations → значит NEXUS должен иметь 100+ integrations.

Вместо этого оцени каждую capability.

Создай:

# Maltego Capability Matrix

| Capability | Maltego | NEXUS Need | Free Option | Local Option | API Required | Hidden Cloud | Priority |
| ---------- | ------- | ---------- | ----------- | ------------ | ------------ | ------------ | -------- |

---

# 17. КЛАССИФИКАЦИЯ ИНТЕГРАЦИЙ

Каждый потенциальный источник классифицировать:

### A — Free / Open / Local

Можно интегрировать напрямую при разрешённой лицензии или через локальный execution.

### B — Public API

Есть API, но может потребоваться registration/token.

### C — Free Tier

Есть ограниченный бесплатный доступ.

### D — Paid

Нужна платная лицензия.

### E — External Only

NEXUS может только предоставить ссылку / открыть источник.

### F — Unsupported

Технически или архитектурно не подходит.

---

# 18. API TOKEN RULE

Никогда не предполагай:

> "нет API key = API бесплатный."

Для каждого API проверь официальную документацию и статус доступа.

Нужно различать:

- no credentials;
- anonymous public endpoint;
- free API key;
- free tier;
- paid-only;
- trial;
- account required.

---

# 19. LOCAL-FIRST INTEGRATIONS

Приоритет отдавай:

# Local / Open Source

потому что NEXUS должен прежде всего работать локально.

Если capability можно получить локальным engine:

предпочесть его платному remote service.

---

# 20. FALLBACK CHAIN

Для каждой capability создай:

```text
Primary
   ↓
Free Alternative
   ↓
Local Alternative
   ↓
External Source
   ↓
Manual
```

Например:

```text
Domain Information

Engine A
↓
Engine B
↓
Local Engine
↓
Open External Website
```

---

# 21. TRANSFORM PRIORITY SYSTEM

Каждому Transform присвоить:

### Core

необходим для NEXUS.

### Recommended

очень полезен.

### Optional

дополнительная ценность.

### Experimental

пока тестовый.

### External

не интегрируется напрямую.

### Deprecated

не использовать.

---

# 22. TRANSFORM QUALITY SCORE

Создай:

# Transform Score

Учитывать:

- usefulness;
- reliability;
- maintenance;
- speed;
- privacy;
- local compatibility;
- API stability;
- result quality;
- license;
- security;
- resource consumption.

---

# 23. NEXUS TRANSFORM LIBRARY

Создай интерфейс:

# Transform Library

Категории:

- Identity
- Username
- Email
- Phone
- Domain
- DNS
- IP
- Infrastructure
- Website
- Repository
- Documents
- Images
- Metadata
- Search
- Archives
- Public Records
- Organizations
- Geography
- Security Research
- Cryptography-related public data
- Blockchain public data
- Social/public sources
- Analysis
- AI
- Automation

Финальную taxonomy определить самостоятельно после аудита.

---

# 24. TRANSFORM SEARCH

Пользователь вводит:

`username`

и видит:

### Available transforms

и:

### Recommended transforms.

---

# 25. TRANSFORM GRAPH

Каждый Transform также должен существовать как объект графа.

Например:

```text
Username
   ↓
[Discover Public Profiles]
   ↓
Profiles
```

Пользователь может добавить Transform на canvas.

---

# 26. VISUAL WORKFLOW

Теперь пользователь может визуально создавать:

```text
[Username]
      ↓
[Public Profile Discovery]
      ↓
[Profile]
      ↓
[Domain Discovery]
      ↓
[Domain]
```

Это становится полноценным:

# Visual Research Workflow

---

# 27. TRANSFORM NODES

На canvas Transform Node должен иметь:

- icon;
- name;
- category;
- input;
- output;
- status;
- engine;
- runtime;
- results count.

---

# 28. EXECUTION STATE

Во время работы:

```text
Transform
[Running]
████████░░
```

После:

```text
[Completed]
27 results
```

Ошибка:

```text
[Failed]
Retry
```

---

# 29. RESULT PREVIEW

После Transform:

показывать:

### New Entities

### New Relationships

### Evidence

### Sources

### Warnings

---

# 30. APPLY RESULTS

Очень важное UX-правило.

Не всегда автоматически добавляй все результаты в основной graph.

Дай варианты:

### Add All

### Add Selected

### Preview

### Ignore

### Create Cluster

---

# 31. RESULT CLUSTER

Если Transform вернул 200 объектов:

не добавляй автоматически 200 огромных карточек.

Создай:

**Result Cluster**

например:

```text
Sherlock Results
47 findings
```

Клик:

**Expand**

раскрывает объекты.

---

# 32. GRAPH DENSITY CONTROL

Добавь настройки:

### Minimal

только основные nodes.

### Balanced

основные + важные relationships.

### Full

все результаты.

---

# 33. TRANSFORM CHAINING

Пользователь должен иметь возможность:

Transform A result

→ автоматически передать в Transform B.

Например:

```text
Domain
 ↓
Subdomain Discovery
 ↓
Subdomain
 ↓
IP Resolution
 ↓
IP
```

---

# 34. SMART CHAINING

AI может предложить:

> Новые домены найдены.
>
> Продолжить анализ инфраструктуры?

Actions:

**Continue**

**Preview Plan**

**Stop**

---

# 35. AGENTIC TRANSFORM PLANNING

Research Agent должен иметь возможность строить chain самостоятельно.

Но только в рамках:

- permissions;
- resource budget;
- user controls;
- execution depth.

---

# 36. НЕ ДЕЛАЙ БЕСКОНЕЧНОГО АГЕНТА

Обязательные лимиты:

- maximum iterations;
- maximum transformations;
- maximum execution time;
- maximum resource budget;
- maximum result count;
- duplicate suppression.

---

# 37. TRANSFORM EXPLANATION

Перед запуском глубокого workflow AI должен уметь объяснить:

### Why this transform?

### Why this engine?

### What will it produce?

### What data does it require?

### What are the limitations?

---

# 38. FREE / PAID FILTER

В Transform Library добавить:

### Free

### Free API

### Local

### Requires API Key

### Paid

### External

Но статус должен основываться на актуальной документации, а не на предположениях.

---

# 39. NO TOKEN MODE

Особенно интересно сделать:

# Zero-Credential Mode

Пользователь выбирает:

**Only use integrations requiring no API credentials.**

Система запускает только подходящие local/public capabilities.

---

# 40. FREE-TIER MODE

Режим:

# Free-Tier Mode

Использует:

- бесплатные API;
- free-tier services;
- local engines;
- public datasets;

при этом отслеживает лимиты.

---

# 41. USER-CONFIGURED MODE

Пользователь позже может открыть:

# Providers

и добавить API keys.

Но это должно быть:

### Optional.

Не обязательная часть Local Mode.

---

# 42. PROVIDER VAULT

Создай безопасное хранилище credentials.

API keys:

- не показывать в обычном UI;
- не отправлять без необходимости;
- не логировать;
- не хранить в source code;
- не сохранять в graph;
- не отправлять AI model без необходимости.

---

# 43. PROVIDER STATUS

Для каждого provider:

```text
Configured
Not configured
Invalid
Rate limited
Disabled
Unavailable
```

---

# 44. TRANSFORM AVAILABILITY

Если API key отсутствует:

НЕ показывать:

> Error

Показывать:

**Requires provider configuration**

и предложить:

### Configure

или:

### Use Free Alternative

или:

### Run Local Alternative

---

# 45. AUTOMATIC FALLBACK

Например:

Transform A:

Provider unavailable.

Система автоматически:

1. ищет free alternative;
2. ищет local engine;
3. ищет compatible external source;
4. предлагает manual fallback.

---

# 46. PROVIDER AGNOSTIC ARCHITECTURE

Нельзя привязывать capability к Maltego.

Например:

```text
Capability:
Email Domain Resolution

Provider:
A
B
C
```

---

# 47. MALTEGO DATA HUB ≠ NEXUS PROVIDER

Maltego Data Hub должен рассматриваться как:

**source of ecosystem knowledge**

а не как backend API NEXUS.

Не пытайся строить NEXUS поверх закрытой инфраструктуры Maltego.

---

# 48. NEXUS PROVIDER REGISTRY

Сделай собственный:

# Provider Registry

с:

- provider;
- capabilities;
- pricing;
- credentials;
- limits;
- endpoint;
- version;
- status;
- security;
- license;
- compatibility.

---

# 49. OPEN SOURCE PREFERENCE

При прочих равных:

```text
Local Open Source
   >
Public Free API
   >
Free Tier
   >
Paid API
   >
External Website
```

Но только если:

- quality comparable;
- maintained;
- secure;
- legally usable;
- technically compatible.

---

# 50. MALTEGO FEATURE AUDIT

Изучи отдельно:

### Maltego Graph

### Maltego Search

### Maltego Data

### Maltego Evidence

### Maltego Monitor

### Cases / investigation management

### Transform ecosystem

### Entity model

### Graph interaction

### Search experience

### Data-source abstraction

### Result handling

### Visualization

### Collaboration capabilities

### Evidence workflows

### Reporting

Не пытайся копировать всё.

Для каждой функции написать:

```text
Keep
Adapt
Improve
Replace
Reject
```

---

# 51. COMPETITIVE FEATURE TABLE

Создай:

| Feature | Maltego | NEXUS | Keep? | Improve How? |
| ------- | ------- | ----- | ----- | ------------ |

---

# 52. ГЛАВНОЕ ПРЕИМУЩЕСТВО NEXUS

После этого этапа NEXUS должен выигрывать не количеством integrations.

Он должен выигрывать:

### Better graph UX

### Better performance

### Better automation

### Better local-first architecture

### Better extensibility

### Better documentation

### Better entity normalization

### Better workflow construction

### Better visualization

---

# 53. НЕ ПЕРЕНОСИ ПЛОХОЙ UX

Если Maltego делает что-то неудобно:

НЕ копируй.

Запиши:

```text
Observed problem
↓
Why it is bad
↓
NEXUS solution
```

---

# 54. GRAPH UX REVIEW

Отдельно изучи:

- node creation;
- selection;
- transform execution;
- result injection;
- relationship drawing;
- graph expansion;
- clustering;
- filtering;
- zoom;
- pan;
- context menus;
- keyboard shortcuts.

Для каждого элемента проектируй NEXUS-native version.

---

# 55. ПОЛНАЯ ВИЗУАЛЬНАЯ ПЕРЕРАБОТКА

Главное правило:

# Maltego functionality, NEXUS visualization.

То есть функциональный принцип можно использовать как reference.

Визуально NEXUS должен оставаться:

- dark;
- premium;
- smooth;
- minimal;
- fast;
- graph-centric;
- modern.

---

# 56. TRANSFORM ANIMATION

Когда пользователь запускает Transform:

из исходного Node визуально должен появляться:

```text
Node
 ↓
Transform
 ↓
Result Cluster
```

Но animation должна быть лёгкой.

---

# 57. EXPAND GRAPH

Кнопка:

# Expand

на Node.

Она запускает рекомендованный набор transforms и визуально раскрывает окружение.

Например:

```text
Domain
  ↓
Expand
  ↓
DNS
Subdomains
Certificates
Archives
Repositories
Related Websites
```

Но список определяется capability engine.

---

# 58. "EXPAND 1 HOP"

Показывать только прямые результаты.

### 1 Hop

только ближайшие.

### 2 Hop

результаты результатов.

### Deep

более глубокая цепочка.

---

# 59. EXPAND PREVIEW

Перед массовым раскрытием:

```text
Expand Domain

Will run:
5 transforms

Estimated:
~30–80 entities

Possible runtime:
~10–40 sec

[Run]
[Customize]
[Cancel]
```

---

# 60. GRAPH BUDGET

Пользователь должен иметь возможность ограничить:

- maximum new nodes;
- maximum depth;
- maximum runtime;
- maximum parallel jobs.

---

# 61. SMART DEDUPLICATION

Если два transforms вернули одинаковый entity:

не создавать два узла.

Объединить:

```text
Entity
Sources: 3
Transforms: 2
```

---

# 62. SOURCE MULTIPLICITY

Node может иметь:

### Sources

1. Sherlock

2. GitHub

3. Search

4. Manual

Это полезнее, чем четыре разных одинаковых node.

---

# 63. RESULT CONFIDENCE

Каждый generated entity может иметь:

- source count;
- evidence count;
- confidence;
- transformation chain.

---

# 64. TRACEABILITY

Пользователь должен иметь возможность открыть:

# How was this entity discovered?

Например:

```text
Entity
↓
Transform A
↓
Source B
↓
Result C
```

---

# 65. TRANSFORM HISTORY

Каждый запуск сохраняется:

- transform;
- input;
- engine;
- provider;
- version;
- timestamp;
- result count;
- errors;
- duration.

---

# 66. REPLAY

Пользователь может:

# Re-run Transform

при текущих условиях.

---

# 67. COMPARE RUNS

Сравнить:

Run 1

и

Run 2

показывая:

- new entities;
- removed;
- changed;
- new evidence.

---

# 68. TRANSFORM CACHE

Кэшировать результат по:

```text
Input
+
Transform
+
Engine
+
Version
+
Provider
```

с TTL, если это допустимо источником.

---

# 69. PRIVACY CONTROL

Для каждого Transform отображать:

### Local

### Remote

### External

Пользователь должен понимать, покидают ли данные его компьютера.

---

# 70. DATA FLOW VIEW

Добавь:

# Data Flow

при запуске Transform.

Например:

```text
Local Node
   ↓
Engine
   ↓
External API
   ↓
Response
   ↓
NEXUS
```

Это особенно важно для privacy.

---

# 71. LOCAL-ONLY MODE

Создай:

# Strict Local Mode

Когда запрещаются:

- external APIs;
- remote providers;
- remote AI;
- cloud integrations;

если пользователь явно не разрешил их.

---

# 72. NETWORK PERMISSION

Для каждого engine:

```text
Local
Network Access
External API
```

и capability requirements.

---

# 73. ENGINE SANDBOX

Локальные third-party engines запускать через безопасный execution boundary.

Нельзя позволять случайному plugin получить полный доступ ко всей файловой системе.

---

# 74. PLUGIN PERMISSIONS

Каждый Transform / Engine может запросить:

- network;
- filesystem;
- subprocess;
- credentials;
- browser;
- external API.

Пользователь / administrator может разрешить или запретить.

---

# 75. TRANSFORM INSTALLATION

В будущем:

# Install Transform

Система:

1. показывает source;
2. license;
3. requirements;
4. permissions;
5. compatibility;
6. security;
7. resource usage;
8. maintainer;
9. last verified;
10. alternatives.

Только после этого:

Install.

---

# 76. NO AUTO-EXECUTION OF UNKNOWN CODE

Никогда не устанавливай и не запускай неизвестный сторонний код автоматически только потому, что он найден в интернете.

Новый engine должен пройти:

- manifest validation;
- dependency review;
- license review;
- compatibility check;
- security check;
- health check.

---

# 77. MALTEGO TRANSFORM CONCEPT → NEXUS TRANSFORM SDK

Создай собственный:

# NEXUS Transform SDK

Разработчик сможет создать:

```text
Input
↓
Transform logic
↓
Normalized entities
↓
Relationships
↓
Evidence
```

---

# 78. TRANSFORM SDK INTERFACE

Минимально:

```text
initialize()
validateInput()
execute()
streamResults()
normalize()
buildRelationships()
getMetadata()
healthCheck()
cleanup()
```

Но выбери окончательный API самостоятельно.

---

# 79. TRANSFORM DEVELOPMENT MODE

Создай developer mode:

### Test Input

### Run

### Raw Output

### Normalized Output

### Entities

### Relationships

### Performance

### Errors

---

# 80. TRANSFORM TEST HARNESS

Каждый Transform должен иметь возможность запускаться в тестовом режиме с fixture data.

---

# 81. CONTRACT TESTING

Проверять:

- input schema;
- output schema;
- entity schema;
- relationship schema;
- errors;
- timeout;
- cancellation.

---

# 82. CANCELLATION

Пользователь должен уметь:

# Stop

остановить Transform.

Оркестратор должен корректно завершить execution.

---

# 83. PARTIAL RESULTS

Если Transform был остановлен на 70%:

сохрани допустимые результаты.

Не теряй всё.

---

# 84. FAILED RESULT

Ошибочные операции должны иметь:

- reason;
- engine;
- provider;
- retry;
- alternative.

---

# 85. "BEST AVAILABLE"

Добавь universal action:

# Find Best Available Source

NEXUS анализирует:

- local engines;
- free providers;
- configured providers;
- external sources;
- availability;
- confidence;
- speed.

и выбирает оптимальный вариант.

---

# 86. "FREE AVAILABLE"

Отдельный режим:

# Use Free Sources Only

Он запрещает использование платных providers.

---

# 87. "LOCAL AVAILABLE"

Отдельный режим:

# Local Engines Only

---

# 88. "ALL AVAILABLE"

Режим:

# Maximum Coverage

Но обязательно:

- подтверждение;
- execution plan;
- resource limits;
- network disclosure.

---

# 89. TRANSFORM PLAN

Перед Maximum Coverage:

```text
Plan

12 transforms
7 local
3 free APIs
2 configured providers

Estimated resources:
...

Estimated runtime:
...

Potential outputs:
...

[Run]
```

---

# 90. MALTEGO BASIC / FREE MODEL НЕ КОПИРОВАТЬ

Maltego имеет бесплатный Basic-план, но он имеет ограничения по Graph и credits, поэтому не надо считать весь Maltego Data Hub "бесплатным".

В NEXUS нужно самостоятельно определить:

### Native Free

### Local Free

### External Free

### Free Tier

### Paid Integration

и никогда не смешивать эти статусы.

---

# 91. RESOURCE CATALOG EXTENSION

Расширь ранее созданный Resource Catalog.

Теперь Resource должен поддерживать:

- documentation;
- capability;
- provider;
- transform;
- engine;
- integration status;
- source;
- license;
- pricing;
- credentials;
- compatibility.

---

# 92. MALTEGO RESEARCH REPORT

Создай отдельный документ:

```text
/docs/ecosystem/MALTEGO_AUDIT.md
```

Он должен содержать:

### What Maltego does well

### What Maltego does poorly

### Valuable capabilities

### Valuable transform patterns

### Valuable data-source patterns

### Valuable UX ideas

### Features NEXUS should adopt

### Features NEXUS should improve

### Features NEXUS should reject

### Licensing considerations

### API requirements

### Free sources

### Local alternatives

### Compatibility

---

# 93. PROVIDER CATALOG

Создай:

```text
/docs/ecosystem/PROVIDER_CATALOG.md
```

Там:

| Provider | Capability | Credentials | Free | Local | Paid | Status | Alternative |
| -------- | ---------- | ----------- | ---- | ----- | ---- | ------ | ----------- |

---

# 94. TRANSFORM CATALOG

Создай:

```text
/docs/ecosystem/TRANSFORM_CATALOG.md
```

Для каждого:

- transform;
- inputs;
- outputs;
- engines;
- providers;
- status;
- requirements;
- performance;
- alternatives.

---

# 95. ПЕРЕПРОВЕРКА АКТУАЛЬНОСТИ

Перед импортом каждой external capability:

проверь текущую документацию.

Не используй старые tutorial pages как источник истины.

Для каждого integration сохраняй:

**Last Verified**

---

# 96. DEPRECATION ENGINE

Если provider / transform:

- archived;
- deprecated;
- API removed;
- project abandoned;

автоматически:

1. пометить;
2. отключить от recommendation;
3. предложить alternative;
4. сохранить исторические данные.

---

# 97. COMPETITOR-AWARE NEXUS

AI должен постоянно сравнивать:

NEXUS

vs

Maltego

vs

другие современные research / graph / intelligence systems.

Но цель:

не копировать.

А искать:

# "What capability is still missing from NEXUS?"

---

# 98. CONTINUOUS ECOSYSTEM AUDIT

Создай scheduled task:

# Ecosystem Health Check

Он проверяет:

- providers;
- transforms;
- engines;
- repositories;
- APIs;
- documentation;
- compatibility.

---

# 99. UPDATE DASHBOARD

В отдельной developer/admin панели:

```text
Ecosystem Health

Transforms      147
Healthy         132
Needs Review     8
Deprecated       5
Unavailable      2
```

Числа здесь должны быть динамическими, а не mock data.

---

# 100. НЕ ДЕЛАЙ MOCK DATA В PRODUCTION

Если какого-либо provider реально нет:

не создавать фальшивый результат.

Использовать:

- unavailable;
- not configured;
- unsupported;
- placeholder only in development.

---

# 101. MAIN CANVAS INTEGRATION

Главное преимущество NEXUS:

Transform запускается непосредственно из Canvas.

Например:

```text
[Username]
      │
      ├── Discover Profiles
      │
      ├── Search Web
      │
      ├── Repository Search
      │
      └── Expand Identity
```

---

# 102. HOVER ACTIONS

При hover на node:

показывать наиболее полезные actions.

Например:

```text
Username
──────────────
Quick Search
Expand
Investigate
Connect
Documentation
```

---

# 103. RIGHT CLICK

Context menu:

### Expand

### Run Transform

### Find Related

### Create Connection

### Add Evidence

### Open Documentation

### Copy

### Export

### Hide

### Lock

---

# 104. TRANSFORM CHIPS

На node можно показывать небольшие contextual chips:

`+ Profiles`

`+ Domains`

`+ Repositories`

Нажатие запускает соответствующий capability.

---

# 105. ONE-CLICK EXPANSION

Главный UX:

# Expand

Пользователь не должен думать:

"какой Transform мне нужен?"

NEXUS сам выбирает лучшие операции.

---

# 106. EXPANSION PREVIEW

Перед выполнением:

```text
Expand Username

Recommended:
• Profile Discovery
• Repository Discovery
• Web Mentions

Optional:
• Additional Search

No external credentials required for 2 operations.

[Run]
```

---

# 107. GRAPH BEAUTY REQUIREMENT

Даже если после расширения появилось 500 entities:

граф должен оставаться:

- читаемым;
- красивым;
- структурированным;
- быстрым.

Используй:

- clustering;
- edge bundling;
- LOD;
- semantic grouping;
- radial balancing;
- graph folding.

---

# 108. MALTEGO-STYLE FUNCTIONALITY, NEXUS-STYLE VISUALIZATION

Это одно из главных правил данного этапа.

# FUNCTIONAL IDEA:

Maltego-inspired.

# VISUALIZATION:

NEXUS-native.

# ARCHITECTURE:

NEXUS-native.

# DATA MODEL:

NEXUS-native.

# PERFORMANCE:

NEXUS-optimized.

---

# 109. НЕ ПЫТАЙСЯ ВЫПОЛНИТЬ ВСЁ ОДНИМ PR

Разбей реализацию:

### Phase 1

Maltego ecosystem audit.

### Phase 2

Transform model.

### Phase 3

Transform registry.

### Phase 4

Provider registry.

### Phase 5

Transform SDK.

### Phase 6

Execution integration.

### Phase 7

Canvas transform UX.

### Phase 8

Expand engine.

### Phase 9

Free / Local modes.

### Phase 10

Provider vault.

### Phase 11

Security sandbox.

### Phase 12

Transform catalog.

### Phase 13

Ecosystem health.

### Phase 14

Performance.

### Phase 15

QA.

Но самостоятельно оптимизируй порядок.

---

# 110. FINAL ACCEPTANCE CRITERIA

После завершения этого этапа я должен иметь возможность:

### A.

Создать Username Node.

### B.

Нажать Expand.

### C.

Получить список подходящих transforms.

### D.

Запустить их одним действием.

### E.

Получать результаты постепенно.

### F.

Автоматически создавать entities.

### G.

Автоматически создавать relationships.

### H.

Не получать дубликаты.

### I.

Видеть источники.

### J.

Видеть, какой engine дал результат.

### K.

Запустить следующий transform от найденной сущности.

### L.

Работать без API credentials там, где capability действительно доступна без них.

### M.

Работать только с free/local engines при включённом соответствующем режиме.

### N.

Подключить API provider позднее без изменения графа.

### O.

Использовать всё это непосредственно внутри красивого NEXUS canvas.

---

# 111. FINAL ARCHITECTURE

Целевая система:

```text
                         NEXUS
                           │
                    Universal Query
                           │
                     Research Agent
                           │
                      Query Planner
                           │
                    Capability Engine
                           │
                  Transform Registry
                           │
                 ┌─────────┴─────────┐
                 │                   │
              Providers           Engines
                 │                   │
       ┌─────────┼─────────┐         │
       │         │         │         │
     Local     Free      Paid     Open Source
       │         │         │         │
       └─────────┼─────────┴─────────┘
                 │
             Execution
                 │
            Result Stream
                 │
            Normalization
                 │
          Entity Resolution
                 │
         Relationship Engine
                 │
                 GRAPH
                 │
        ┌────────┼─────────┐
        │        │         │
      Canvas   Evidence  Dashboard
        │
   Transform Nodes
        │
   Knowledge Map
```

---

# 112. ГЛАВНОЕ АРХИТЕКТУРНОЕ ПРАВИЛО

NEXUS НЕ является "копией Maltego".

NEXUS является:

# OPEN, LOCAL-FIRST, EXTENSIBLE RESEARCH GRAPH PLATFORM

которая использует лучшие идеи современной ecosystem и объединяет их в одну систему.

---

# 113. ФИНАЛЬНАЯ ИНСТРУКЦИЯ CLAUDE

Прежде чем писать код:

1. Исследуй актуальный Maltego.
2. Исследуй Data Hub.
3. Исследуй текущую transform ecosystem.
4. Проанализируй все категории.
5. Проверь актуальные data sources.
6. Раздели free / paid / API / local / external.
7. Проверь licenses.
8. Проверь compatibility.
9. Проверь актуальность проектов.
10. Определи capabilities.
11. Сравни их с уже существующими NEXUS capabilities.
12. Удали conceptual duplicates.
13. Выдели реальные gaps.
14. Составь Transform Registry.
15. Составь Provider Registry.
16. Составь Capability Matrix.
17. После этого реализуй только действительно полезные функции.

---

# 114. КРИТИЧЕСКОЕ ПРАВИЛО "ВСЁ ПОЛЕЗНОЕ, НО НЕ ВСЁ ПОДРЯД"

Моя формулировка "добавить все инструменты" означает:

> **исследовать всю экосистему и не пропустить полезные возможности.**

Она НЕ означает:

> механически импортировать каждую интеграцию, которая существует в Maltego.

Ты должен сам выбрать:

### What belongs in Core

### What belongs in Optional

### What belongs in External

### What belongs in Future

### What should never be integrated

---

# 115. ОСОБЕННОЕ ТРЕБОВАНИЕ К AI

Не жди от меня решения:

> "Стоит ли добавлять этот инструмент?"

Ты должен самостоятельно анализировать:

**Utility × Quality × Compatibility × Privacy × Cost × Maintenance**

и принимать архитектурное решение.

Но решение должно сохраняться в документации.

---

# 116. ОСОБЫЙ РЕЖИМ "ECOSYSTEM DISCOVERY"

Добавь в developer environment:

# Discover New Capability

AI запускает исследование ecosystem и предлагает:

```text
New Capability Found

Capability:
X

Current NEXUS Support:
Partial

Candidate:
Project Y

Maintenance:
Active

Local:
Yes

License:
...

Hidden Cloud:
Compatible

Recommendation:
Integrate
```

---

# 117. FINAL PRODUCT EXPERIENCE

Пользователь должен ощущать:

> Я не запускаю отдельные инструменты.

Он ощущает:

> Я исследую объект.

NEXUS сам понимает:

- какие capabilities доступны;
- какие transforms нужны;
- какие engines лучше;
- какие sources бесплатны;
- какие можно выполнить локально;
- какие требуют credentials;
- какие результаты полезны;
- какие связи нужно построить.

---

# 118. FINAL PRINCIPLE

# ONE NODE

# ONE CLICK

# MANY CAPABILITIES

# ONE GRAPH

Пользователь выбирает сущность.

Нажимает:

**Expand**

NEXUS самостоятельно строит оптимальный transform plan.

После выполнения:

- результаты приходят постепенно;
- duplicates объединяются;
- evidence сохраняется;
- relationships строятся;
- graph организуется;
- пользователь может продолжить исследование.

И всё это должно происходить внутри уже созданной:

# NEXUS KNOWLEDGE GRAPH

а не в отдельных вкладках и не в отдельных приложениях.
