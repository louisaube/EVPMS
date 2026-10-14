# Couverture complémentaire v5 (correction de la matrice de complétude)

`.cuisine/scripts/matrix-check.sh` cherche, sur la ligne de la règle, la formule exacte « not observable ». Les trois règles ci-dessous ont été remplacées par la v5 (disputes ACCEPTED dans `specifications/evp/implementation-plans/v5-evp-rattachement-nir/DISPUTES.md`) : leurs tests ont été supprimés ou réécrits sous les règles qui les remplacent. Aucune ligne existante n'est modifiée.

| Rule id | Verdict |
|---|---|
| rule-evp-aqoona-nir-fallback-name | not observable any more: the fallback on first and last name was removed in v5 (`rule-evp-link-nir-only`); a row without a usable NIR is now never attached by name and carries a cause, tested under `[rule-evp-link-causes]` and `[rule-evp-link-nir-only]`. |
| rule-evp-aqoona-nir-scope-company | not observable any more: the search inside the company of the crèche was replaced in v5 by the search across the whole network (`rule-evp-link-network-wide`), tested in `acceptance-v5-linking.test.ts`. |
| rule-evp-matching-rates-three-parts | not observable any more: the three parts were replaced in v5 by two parts counted in people, attached and not linked (`rule-evp-matching-rates-people`), tested in `acceptance-v5-people-rates.test.ts`. |

`rule-evp-unlinked-list-all-causes-visible` is not justified here: it is covered by the new test `[rule-evp-unlinked-list-all-causes-visible]` in `acceptance-v5-linking.test.ts` (the five causes each appear in the list with their own French label). The on-screen display itself stays covered by the Playwright tests of `acceptance/e2e/`.
