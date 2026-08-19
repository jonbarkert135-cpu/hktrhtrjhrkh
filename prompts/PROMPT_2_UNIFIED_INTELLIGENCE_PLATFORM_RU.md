# PROMPT 2

# ДОПОЛНЕНИЕ К MASTER PROMPT — UNIFIED INTELLIGENCE PLATFORM

Этот документ является **вторым, обязательным этапом** после основного MASTER PROMPT проекта NEXUS.

Не создавай новый независимый продукт.

Не начинай архитектуру заново.

Используй уже созданную архитектуру NEXUS как фундамент и теперь преврати её в _Unified Intelligence
Platform_, которая собирает лучшие актуальные возможности из существующих Open Source проектов,
сервисов, библиотек, исследовательских платформ и собственных модулей в одну красивую, единую
систему.

Главная идея этого этапа:

> _Не заставлять пользователя открывать десять разных сервисов._
> Пользователь делает один запрос в NEXUS, после чего система сама определяет, какие подключённые
> движки способны помочь, запускает их параллельно или последовательно, собирает результаты,
> нормализует их, удаляет дубликаты, строит связи и показывает всё в едином интерфейсе.

---

## 1. ОСНОВНОЕ ПРАВИЛО ЭТОГО ЭТАПА

Теперь ты работаешь не просто как разработчик.

Ты одновременно:

- Principal Architect
- Intelligence Platform Architect
- Open Source Researcher
- Competitive Analyst
- Integration Engineer
- DevOps Engineer
- Security Engineer
- Performance Engineer
- UX Architect
- Product Strategist

Твоя задача — провести _максимально широкий аудит существующего экосистемного пространства_ и
определить:

1. Что уже существует.
2. Что реально работает сегодня.
3. Что активно поддерживается.
4. Что устарело.
5. Что заброшено.
6. Что имеет хороший API.
7. Что имеет CLI.
8. Что можно безопасно интегрировать.
9. Что можно запускать локально.
10. Что можно запускать на сервере.
11. Что требует Docker.
12. Что требует специфической ОС.
13. Что требует сложной инфраструктуры.
14. Что можно заменить более современным проектом.
15. Что стоит реализовать самостоятельно.
16. Что лучше использовать как библиотеку.
17. Что лучше подключать как внешний сервис.
18. Что нельзя безопасно или технически нормально включать в платформу.

---

## 2. НЕ ОГРАНИЧИВАЙСЯ GITHUB

Это критически важно.

Не считай GitHub единственным источником.

Проведи исследование:

- GitHub;
- GitLab;
- Codeberg;
- SourceForge;
- официальные сайты Open Source проектов;
- документацию;
- официальные API;
- package registries;
- npm;
- PyPI;
- crates.io;
- Docker Hub;
- исследовательские проекты;
- академические проекты;
- self-hosted tools;
- open-source intelligence platforms;
- graph databases;
- data enrichment systems;
- document analysis systems;
- metadata extraction systems;
- search systems;
- browser automation frameworks;
- web research systems;
- AI agents;
- data visualization libraries.

Если проект находится не на GitHub, но технически и лицензионно пригоден для интеграции — также
рассматривай его.

---

## 3. ИССЛЕДУЙ НЕ ТОЛЬКО OSINT

Не ограничивайся SpiderFoot и Sherlock.

Ищи _все категории технологий_, которые могут усилить NEXUS. Например:

**Discovery** — username discovery; domain discovery; email discovery; company discovery; repository
discovery; public-source discovery.

**Search** — search aggregation; custom search; document search; code search; semantic search.

**Metadata** — image metadata; document metadata; URL metadata; repository metadata; file analysis.

**Graph** — graph databases; knowledge graphs; entity relationship systems; graph visualization.

**Documents** — PDF parsing; OCR; document extraction; table extraction; text extraction; entity
extraction.

**Images** — EXIF; reverse image workflows; image similarity; OCR; visual metadata.

**Code** — repository analysis; dependency analysis; static analysis; package analysis; architecture
analysis.

**Web Research** — page extraction; crawling; indexing; content extraction; website metadata.

**Automation** — browser automation; headless browser systems; workflow engines; job queues.

**AI** — LLM agents; summarization; entity extraction; classification; relation extraction; research
planning; result synthesis.

**Data Visualization** — graphs; timelines; maps; tables; charts; relationship networks.

---

## 4. НЕОБХОДИМО ПРОВЕСТИ COMPETITOR AUDIT

Проведи отдельное исследование существующих продуктов. Не просто Open Source. Изучи также
современные коммерческие и исследовательские платформы, чтобы понять:

- какие функции уже считаются стандартом;
- какие UX-паттерны являются лучшими;
- какие функции пользователям реально полезны;
- какие функции выглядят красиво, но практически бесполезны;
- где существуют неудобства;
- чего не хватает существующим решениям.

Исследуй современные: research platforms; knowledge graph systems; visual investigation tools;
workflow systems; AI research systems; intelligence platforms; graph analysis platforms; knowledge
management tools; canvas products; collaborative research products.

НЕ КОПИРУЙ их интерфейс. Используй анализ только для создания более сильного собственного UX.

---

## 5. СОЗДАЙ COMPETITOR MATRIX

Сделай таблицу:

`Product | Category | Best Features | Weaknesses | Open Source | Self-hosted | API | Plugin Friendly | Architecture | UX | Relevant for NEXUS`

После этого отдельно выдели:

- Best ideas to adopt
- Ideas to improve
- Ideas to reject
- Ideas to build ourselves

---

## 6. НЕ ИСПОЛЬЗУЙ УСТАРЕВШИЕ ПРОЕКТЫ

Одна из главных целей этого этапа:

> _НЕ собрать музей старого Open Source._

Для каждого потенциального проекта оцени: последний release; активность commits; pull requests;
issue activity; documentation quality; dependency health; supported runtime; supported OS;
architecture; security history; license; API stability; community health.

Введи внутренний статус:

- **Tier A** — actively maintained / production quality.
- **Tier B** — useful but requires adapter / monitoring.
- **Tier C** — useful conceptually but aging.
- **Tier D** — deprecated / abandoned / unsafe.
- **Tier E** — do not integrate.

В NEXUS автоматически попадают только проекты, которые действительно имеют смысл для production.

---

## Примечание владельца продукта

Проект называется **Raven OSINT**; «NEXUS» в тексте промта — старое имя.
