# Couverture complémentaire v3 (correction de la matrice de complétude)

`.cuisine/scripts/matrix-check.sh` cherche, sur la ligne de la règle, la formule exacte « not observable ». Les lignes de `COVERAGE-v3-evp-acces-contrats-siret.md` disaient « Non observable » (en français) ou renvoyaient à une suite sans titre de test citant la règle. Les verdicts ci-dessous les complètent ; aucune ligne existante n'est modifiée.

| Rule id | Verdict |
|---|---|
| rule-evp-access-session-version | not observable directly: internal column (`evp_accounts.session_version`) that never leaves the API; its effect is tested through `[rule-evp-access-unlink-session]` (session opened after the unlink is valid, earlier one stays cut, also on the second cycle). |
| rule-evp-aqoona-nir-pii-logging | not observable in black-box terms for the code part (absence of `console.*` / `logger.*` in `sources/` is a static developer test, `aqoona-pros-units.test.ts`); the observable part (no NIR value in `api/.server-test.log`) is tested under `[rule-evp-aqoona-nir-never-stored]`. |
| rule-evp-google-sub-email-change | not observable any more: the behaviour (bound sub with another address opens the session) was removed in v3 and replaced by `[rule-evp-google-sub-email-mismatch]` (dispute ACCEPTED in `v3-evp-acces-contrats-siret/DISPUTES.md`). |
| rule-evp-sources-nir-discarded | not observable any more: replaced for the « Pros » flow by `[rule-evp-aqoona-nir-transient-key]` and `[rule-evp-aqoona-nir-never-stored]`; the « Matricule écarté » volume no longer exists (disputes ACCEPTED). |
| rule-evp-sources-nir-redaction-studio | not observable through the API: defence in depth of `SourcesPage.tsx` (a NIR-looking run of digits is masked on screen); the API never delivers a NIR (`[rule-evp-aqoona-nir-never-stored]`), so the studio branch cannot be reached from a real response. Studio behaviour, no browser test. |
| rule-evp-login-howto-who | not observable through the API: wording of the login screen's how-to (functions named, never first names); studio text, covered by the page plan `connexion-page-implementation-plan.md`. |
| rule-evp-login-unknown-error | not observable through the API: the login screen shows the `echec` message for any unknown `erreur` value; studio behaviour. |

`rule-evp-aqoona-partial-failure` is not justified here: it is covered by the new test `[rule-evp-aqoona-partial-failure]` in `acceptance-v3-sources-aqoona.test.ts` (address that fails keeps its previous plannings; the next successful reading replaces them). The `PARTIAL` state with several addresses stays covered by v2.
