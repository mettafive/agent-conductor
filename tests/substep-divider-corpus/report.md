# Substep-divider corpus — visual-step coverage (improved logic)

120/120 cases surface a board card for **every** named work-unit.
Visual-step coverage: **520/520** units (100.0%).
Divider phases surfaced: **151/151** (gate-less dividers are GOOD — they still get a card).
Obscure cases complete: **20/20** — the generalization test.

| case | obscure | valid | declared | surfaced | dividers kept | coverage |
|---|---|---|---|---|---|---|
| daily-enrichment |  | ✓ | 6 | 6 | 2/2 | 100% |
| blog-pipeline |  | ✓ | 5 | 5 | 2/2 | 100% |
| newsletter |  | ✓ | 5 | 5 | 2/2 | 100% |
| doc-rewrite |  | ✓ | 5 | 5 | 2/2 | 100% |
| product-copy |  | ✓ | 5 | 5 | 2/2 | 100% |
| release-notes |  | ✓ | 5 | 5 | 1/1 | 100% |
| etl-load |  | ✓ | 6 | 6 | 2/2 | 100% |
| csv-clean |  | ✓ | 5 | 5 | 2/2 | 100% |
| db-migrate |  | ✓ | 4 | 4 | 1/1 | 100% |
| api-sync |  | ✓ | 4 | 4 | 1/1 | 100% |
| geo-encode |  | ✓ | 4 | 4 | 1/1 | 100% |
| pr-review |  | ✓ | 5 | 5 | 2/2 | 100% |
| dep-bump |  | ✓ | 5 | 5 | 2/2 | 100% |
| test-gen |  | ✓ | 4 | 4 | 1/1 | 100% |
| refactor-pass |  | ✓ | 4 | 4 | 1/1 | 100% |
| ci-pipeline |  | ✓ | 6 | 6 | 1/1 | 100% |
| incident-response |  | ✓ | 5 | 5 | 2/2 | 100% |
| market-research |  | ✓ | 5 | 5 | 2/2 | 100% |
| literature-review |  | ✓ | 4 | 4 | 1/1 | 100% |
| survey-readout |  | ✓ | 5 | 5 | 2/2 | 100% |
| ab-analysis |  | ✓ | 4 | 4 | 1/1 | 100% |
| log-forensics |  | ✓ | 4 | 4 | 1/1 | 100% |
| deploy-flow |  | ✓ | 5 | 5 | 1/1 | 100% |
| backup-verify |  | ✓ | 4 | 4 | 1/1 | 100% |
| cert-renew |  | ✓ | 4 | 4 | 1/1 | 100% |
| scaling-audit |  | ✓ | 4 | 4 | 1/1 | 100% |
| support-triage |  | ✓ | 5 | 5 | 1/1 | 100% |
| kb-refresh |  | ✓ | 4 | 4 | 1/1 | 100% |
| onboarding-emails |  | ✓ | 4 | 4 | 1/1 | 100% |
| image-pipeline |  | ✓ | 5 | 5 | 2/2 | 100% |
| video-transcode |  | ✓ | 5 | 5 | 2/2 | 100% |
| podcast-publish |  | ✓ | 4 | 4 | 1/1 | 100% |
| price-monitor |  | ✓ | 4 | 4 | 1/1 | 100% |
| inventory-sync |  | ✓ | 4 | 4 | 1/1 | 100% |
| review-moderation |  | ✓ | 4 | 4 | 1/1 | 100% |
| license-audit |  | ✓ | 4 | 4 | 1/1 | 100% |
| gdpr-export |  | ✓ | 4 | 4 | 1/1 | 100% |
| accessibility-sweep |  | ✓ | 5 | 5 | 2/2 | 100% |
| invoice-process |  | ✓ | 4 | 4 | 1/1 | 100% |
| expense-report |  | ✓ | 4 | 4 | 1/1 | 100% |
| payroll-run |  | ✓ | 4 | 4 | 1/1 | 100% |
| seo-audit |  | ✓ | 5 | 5 | 2/2 | 100% |
| ad-campaign |  | ✓ | 4 | 4 | 1/1 | 100% |
| social-schedule |  | ✓ | 5 | 5 | 2/2 | 100% |
| lead-enrich |  | ✓ | 4 | 4 | 1/1 | 100% |
| resume-screen |  | ✓ | 4 | 4 | 1/1 | 100% |
| interview-kit |  | ✓ | 4 | 4 | 1/1 | 100% |
| design-handoff |  | ✓ | 4 | 4 | 1/1 | 100% |
| qa-regression |  | ✓ | 4 | 4 | 1/1 | 100% |
| translation-batch |  | ✓ | 5 | 5 | 2/2 | 100% |
| data-labeling |  | ✓ | 4 | 4 | 1/1 | 100% |
| email-campaign-qa |  | ✓ | 4 | 4 | 1/1 | 100% |
| menu-engineering |  | ✓ | 4 | 4 | 1/1 | 100% |
| course-build |  | ✓ | 5 | 5 | 2/2 | 100% |
| grant-application |  | ✓ | 5 | 5 | 2/2 | 100% |
| contract-review |  | ✓ | 4 | 4 | 1/1 | 100% |
| menu-translation |  | ✓ | 4 | 4 | 1/1 | 100% |
| ticket-dedup |  | ✓ | 4 | 4 | 1/1 | 100% |
| feature-flag-cleanup |  | ✓ | 4 | 4 | 1/1 | 100% |
| sitemap-gen |  | ✓ | 4 | 4 | 1/1 | 100% |
| schema-validate |  | ✓ | 4 | 4 | 1/1 | 100% |
| pentest-recon |  | ✓ | 4 | 4 | 1/1 | 100% |
| model-eval |  | ✓ | 5 | 5 | 2/2 | 100% |
| rag-index |  | ✓ | 4 | 4 | 1/1 | 100% |
| feature-store |  | ✓ | 4 | 4 | 1/1 | 100% |
| alert-tuning |  | ✓ | 4 | 4 | 1/1 | 100% |
| data-quality |  | ✓ | 4 | 4 | 1/1 | 100% |
| api-doc-gen |  | ✓ | 4 | 4 | 1/1 | 100% |
| churn-outreach |  | ✓ | 4 | 4 | 1/1 | 100% |
| warehouse-pick |  | ✓ | 4 | 4 | 1/1 | 100% |
| fleet-maintenance |  | ✓ | 4 | 4 | 1/1 | 100% |
| menu-photo-shoot |  | ✓ | 4 | 4 | 1/1 | 100% |
| tax-prep |  | ✓ | 5 | 5 | 1/1 | 100% |
| event-planning |  | ✓ | 6 | 6 | 2/2 | 100% |
| recipe-scaling |  | ✓ | 4 | 4 | 1/1 | 100% |
| playlist-curate |  | ✓ | 4 | 4 | 1/1 | 100% |
| garden-plan |  | ✓ | 4 | 4 | 1/1 | 100% |
| meal-prep |  | ✓ | 4 | 4 | 1/1 | 100% |
| wardrobe-capsule |  | ✓ | 4 | 4 | 1/1 | 100% |
| study-plan |  | ✓ | 4 | 4 | 1/1 | 100% |
| trip-itinerary |  | ✓ | 5 | 5 | 2/2 | 100% |
| home-inspection |  | ✓ | 4 | 4 | 1/1 | 100% |
| warranty-claim |  | ✓ | 4 | 4 | 1/1 | 100% |
| loan-underwrite |  | ✓ | 4 | 4 | 1/1 | 100% |
| fraud-review |  | ✓ | 4 | 4 | 1/1 | 100% |
| supply-forecast |  | ✓ | 4 | 4 | 1/1 | 100% |
| clinical-coding |  | ✓ | 4 | 4 | 1/1 | 100% |
| lab-result-review |  | ✓ | 4 | 4 | 1/1 | 100% |
| syllabus-build |  | ✓ | 5 | 5 | 2/2 | 100% |
| moderation-queue |  | ✓ | 4 | 4 | 1/1 | 100% |
| ab-image-test |  | ✓ | 4 | 4 | 1/1 | 100% |
| compliance-training |  | ✓ | 4 | 4 | 1/1 | 100% |
| vendor-onboard |  | ✓ | 4 | 4 | 1/1 | 100% |
| menu-nutrition |  | ✓ | 4 | 4 | 1/1 | 100% |
| ad-compliance |  | ✓ | 4 | 4 | 1/1 | 100% |
| patch-rollout |  | ✓ | 4 | 4 | 1/1 | 100% |
| transcription-qa |  | ✓ | 4 | 4 | 1/1 | 100% |
| social-listening |  | ✓ | 4 | 4 | 1/1 | 100% |
| form-builder |  | ✓ | 4 | 4 | 1/1 | 100% |
| store-locator-import |  | ✓ | 4 | 4 | 1/1 | 100% |
| bell-ringing-peal | ★ | ✓ | 5 | 5 | 2/2 | 100% |
| falconry-weight | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| lutherie-setup | ★ | ✓ | 5 | 5 | 2/2 | 100% |
| cuneiform-edit | ★ | ✓ | 5 | 5 | 2/2 | 100% |
| perfume-accord | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| tide-mill-schedule | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| fresco-restoration | ★ | ✓ | 5 | 5 | 2/2 | 100% |
| orienteering-course | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| raku-firing | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| scrimshaw-engrave | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| dressage-test | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| sourdough-cycle | ★ | ✓ | 5 | 5 | 2/2 | 100% |
| lighthouse-log | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| ikebana-arrange | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| glassblowing-vessel | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| campanology-tower | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| marquetry-panel | ★ | ✓ | 4 | 4 | 1/1 | 100% |
| kombucha-batch | ★ | ✓ | 5 | 5 | 2/2 | 100% |
| astro-imaging | ★ | ✓ | 5 | 5 | 2/2 | 100% |
| knot-tying-guide | ★ | ✓ | 4 | 4 | 1/1 | 100% |
