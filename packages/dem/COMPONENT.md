# SPX-DEM-001, préparation des hauteurs et pyramides raster

État documenté le 15 novembre 2026. Propriétaire : `terrain-core`, packages `@spacexr/dem` et `@spacexr/raster`, snapshot `e03321a6930624bc27b18b595aae1372f35d073c`. Le composant documente la préparation partagée des données, distincte de la géométrie GPU `SPX-GEO-001`.

## A. Identité et responsabilités

**Identifiant stable :** `SPX-DEM-001`. **Stages :** CPU, y compris décodage sur workers; aucune passe compute, vertex ou fragment n'est possédée par ce composant. Ses données alimentent ensuite les stages du renderer.

| Sources propriétaires                                                            | Responsabilité                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/codecs/dem.ts`, `dem-infos.ts`, `mapzen-normals.ts`, `terrarium-encoder.ts` | Encodage vers hauteurs en mètres, grille Float32, min/max, valeurs manquantes et contrats d'encodage des normales |
| `src/codecs/dem-decoder.ts`                                                      | Port local ou workers, transfert des bytes et hauteurs, annulation et erreurs                                     |
| `src/sources/dem-tile-source.ts`, `dem-tile-loader.ts`                           | Contrat de source et chargement d'une tuile, sans provider imposé                                                 |
| `src/pyramid/dem-pyramid.ts`                                                     | Pyramide DEM, sous-régions d'ancêtres, hauteur, gradient et politiques multi-niveaux                              |
| `src/pyramid/child-height-ranges.ts`                                             | Ranges mesurés des quadrants transmis aux enfants avant leur propre DEM                                           |
| `src/pyramid/surface-normal.ts`, `tile-surface-normal.ts`                        | Normales de surface et conversion géodétique/radiale paramétrée                                                   |
| `../raster/src/raster-pyramid.ts`                                                | Rétention, génération et partage des rasters de la pyramide                                                       |
| `../raster/src/sampling.ts`, `resampling.ts`, `stitched-raster-grids.ts`         | Registration, échantillonnage, interpolation et arêtes partagées                                                  |
| `../raster/src/image.ts`, `png-data-decoder.ts`                                  | Port de décodage d'image et conservation des canaux numériques                                                    |

Entrées : `IDemTileSource`, bytes encodés, registration explicite `area` ou `point`, adresses et topologie de `@spacexr/tiles`, limites du provider, politique de génération et port de décodage. Sorties : `IHeightGrid`, grilles stitched, `IDemTileHeights`, ranges, gradients et normales. Les rasters génériques sont également utilisés pour imagery, masques et vecteurs; leur appartenance à cette fiche ne signifie pas qu'ils sont réservés au DEM.

Le composant dépend de `@spacexr/tiles` pour pyramides et adresses et de la géodésie partagée lorsqu'une conversion de surface est nécessaire. Il n'importe pas `TileRuntime` et ne décide pas du cut : `SPX-LOD-001` reste l'unique sélectionneur derrière les ports du renderer. `SPX-GEO-001` est son utilisateur GPU; les contrats d'extrémité de `SPX-ATM-001` ne permettent pas de remplacer une hauteur source par une hauteur choisie pour l'éclairage.

Modes réels : décodage local ou worker choisi par l'application; registration `area` charge les voisins nécessaires au stitching; `point` conserve les arêtes déjà publiées sans charger les huit voisins. Sous le niveau source maximal, la génération n'existe que si elle est configurée. Au-delà de la pyramide servie, une tuile géométrique peut échantillonner la sous-région d'un ancêtre, sans requête réseau à un niveau inexistant.

Hors responsabilité : provider terrestre implicite, changement silencieux de datum, sélection LOD parallèle, création de pages GPU ou de shaders, synthèse d'observations inexistantes, correction atmosphérique des hauteurs et déclaration de précision de relief sans référence indépendante.

## B. Justification de son existence

Un contenu DEM n'est ni un tileset ni un mesh. Ses bytes doivent devenir une grille numérique, avec des unités, une registration et une disponibilité explicites, avant que plusieurs tuiles géométriques puissent l'utiliser. Séparer cette préparation évite de recopier codecs, interpolation et arêtes dans chaque renderer.

Le rendu peut raffiner spatialement au-delà du dernier niveau mesuré. La sous-région d'ancêtre ou les niveaux générés répondent à ce besoin tout en conservant l'identité de la source réellement échantillonnée. La disponibilité géométrique n'est donc pas une preuve de données DEM mesurées à ce niveau. Voir [contrats DEM](../../docs/dem.md) et [contrats raster](../../docs/raster.md).

## C. Justification de l'architecture

- `IHeightGrid` stocke un canal Float32 en lignes nord-ouest vers sud-est, des mètres et `NaN` pour l'inconnu. Le décodage d'image préserve les valeurs numériques; une correction colorimétrique ou un alpha prémultiplié altérerait l'encodage de hauteur.
- La registration est une entrée obligatoire. Les pixels d'aire et les points incluant les arêtes ne représentent pas les mêmes positions : un défaut implicite peut déplacer la surface d'un demi-pixel, cas couvert par les tests.
- `RasterPyramid` réutilise `TilePyramid`; le cache de données et son identité sont séparés du cache de handles du renderer et de la sélection `SPX-LOD-001`. Le composant ne crée pas une seconde boucle de traversée.
- `StitchedRasterGrids` partage les échantillons d'arête. Les callbacks `onStitched` et `observeStitched` annoncent les copies GPU à rafraîchir sans leur confier la propriété du raster CPU.
- La génération se poursuit depuis les niveaux parents et leurs voisins selon la registration. Le bilinéaire est le défaut déclaré; les raisons quantitatives du choix initial de toutes les interpolations et résolutions sont `RATIONALE_UNKNOWN` lorsqu'aucune preuve ne les accompagne.
- `ChildHeightRanges` rend les volumes des enfants informés avant leur propre chargement, sans prétendre qu'un range de parent est une mesure fine indépendante.
- Le port worker transfère les buffers, pour éviter une copie lorsque la vue couvre le buffer exact. Une requête annulée est réglée immédiatement côté appelant; le worker peut finir et son résultat est ignoré. Ceci est un contrat CPU, pas une économie GPU chronométrée.

Décisions liées : [SPX-ADR-001](../../../atmosphere-core-r1-7-1/docs/architecture/ADR/SPX-ADR-001.md) (frontières), [SPX-ADR-002](../../../atmosphere-core-r1-7-1/docs/architecture/ADR/SPX-ADR-002.md) (contrat d'extrémité, côté consommateur), [SPX-ADR-005](../../../atmosphere-core-r1-7-1/docs/architecture/ADR/SPX-ADR-005.md) (couverture sans donnée inventée), [SPX-ADR-009](../../../atmosphere-core-r1-7-1/docs/architecture/ADR/SPX-ADR-009.md) (livraison documentaire). [Index fédéré](../../../atmosphere-core-r1-7-1/docs/architecture/COMPONENT_INDEX.md).

## D. Contraintes et invariants

| Nature                   | Exigence                                                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physique, non négociable | Les hauteurs sont des mètres dans le datum déclaré par la source. Une valeur négative valide ne peut être supprimée pour satisfaire un domaine d'éclairage. La conversion géodétique/radiale demande une surface et un système explicitement fournis. |
| Géométrie                | `u` croît vers l'est, `v` vers le sud; les quadrants sont NW, NE, SW, SE. ECEF utilise X/Y équatoriaux et Z polaire chez les consommateurs géodésiques concernés; la source ne devient pas un repère écran.                                           |
| Donnée                   | `NaN` signifie manque numérique; une tuile absente reste absente. Les limites du provider sont conservées et l'adresse DEM réellement servie est exposée.                                                                                             |
| Fonctionnel              | Une même frontière doit fournir la même valeur de surface selon la registration et la politique définies. Les racines restent isolées sauf topologie explicitement connectée; wrapX n'est pas implicite.                                              |
| Cycle de vie             | La rétention/release et les notifications de stitching restent cohérentes; un renderer détenant une copie doit la rafraîchir lorsque les arêtes changent.                                                                                             |
| Contrat de gradients     | La différentiation utilise la cellule de la géométrie demandée et des différences unilatérales lorsqu'un voisin manque; ne pas confondre détail DEM et détail effectivement représentable par le mesh.                                                |
| Choix provisoire         | Interpolation configurée, profondeur générée, taille de cache et nombre de workers sont des choix d'application. Ils ne sont pas des constantes physiques ni des optimums universels.                                                                 |
| Précision non qualifiée  | La justesse de l'encodage et des invariants numériques ne prouve ni exactitude altimétrique absolue ni conformité géoïdale du provider.                                                                                                               |
| Budget mesuré            | Aucun coût CPU ou GPU propre isolé dans l'audit : `COST_NOT_ISOLATED`. Les octets de grilles sont logiques, pas une mesure VRAM.                                                                                                                      |

## E. Historique architectural

### Registration explicite dans l'amont

**Date/version/commit :** 6 novembre 2026 à 01:21:56+01:00, historique amont avant migration terrain-core, `3d-tiles-core@3bc5eac52b6512e89b601a9e1730af9b2b610dce`, « declare the registration of every source and stitch area tiles on pixel corners ».

- **Problème rencontré :** positions des échantillons différentes entre sources area et point.
- **Cause :** une registration incorrecte translate la surface d'un demi-pixel, contre-exemple conservé dans les tests actuels.
- **Décision/solution :** rendre la registration explicite et conserver les chemins de stitching correspondants; le vieux `prestitched` est déprécié et un désaccord est rejeté.
- **Alternatives étudiées :** le comportement historique est consultable dans le parent du commit; `RATIONALE_UNKNOWN` pour un comparatif exhaustif d'autres interpolateurs.
- **Contrainte déterminante :** position des données et arêtes partagées, sans calibrage visuel après coup.
- **Résultat obtenu :** les tests distinguent la registration correcte et le déplacement produit par une déclaration incorrecte.
- **Impact performance :** besoins de voisins différents selon registration; `COST_NOT_ISOLATED` en millisecondes.
- **Validité scientifique :** contrat de position corrigé; pas de qualification de l'altitude du provider.
- **Régression possible :** compatibilité des sources antérieures mal déclarées; l'échec explicite n'est pas remplacé par un défaut silencieux.
- **Tests/preuves :** commit amont et `tests/raster-registration.test.ts`, `../raster/tests/prestitched-rasters.test.ts`.
- **Statut :** `IMPLEMENTED` dans le snapshot terrain documenté. L'identité exacte des bytes de toutes les sources avant migration n'a pas été reconstituée ici.

### Transfert de propriétaire

**Date/version/commit :** 11 novembre 2026 à 06:34:42+01:00, `terrain-core@e03321a6930624bc27b18b595aae1372f35d073c`, « Initialize terrain packages and migrate vector LOD rasterization ».

**Problème/cause :** préparation raster/DEM/grille auparavant mêlée au dépôt générique de tuiles. **Décision/solution :** paquets déplacés dans terrain-core, identités npm conservées, `@spacexr/tiles` et le runtime restent dans 3d-tiles-core. **Alternatives/contrainte :** ne pas recopier ces implémentations dans le renderer; séparation explicite des couches selon AGENTS et les contrats existants. **Résultat :** propriétaire et imports documentés, algorithmes existants conservés selon le périmètre déclaré de migration. **Performances :** aucun gain isolé démontré. **Validité :** pas de nouveau datum ou de nouvelle interprétation scientifique annoncés. **Régression possible :** chemins et packaging; le déplacement ne constitue pas une validation numérique nouvelle. **Tests/preuves :** commit `e03321a`, `AGENTS.md`, `docs/dem.md`, `docs/raster.md`, tests DEM/raster. **Statut :** `IMPLEMENTED`; vérification exécutée à consulter dans le rapport de livraison, non supposée à partir de cette fiche.

### Initialisation de la mémoire

**Date/version/commit :** 15 novembre 2026, mémoire R174, `PENDING_CURRENT_CHANGESET`, `SPX-CHANGE-20261115-MEMORY`.

**Problème/cause :** relations entre donnée, sélection et géométrie insuffisamment persistantes près du code. **Décision/solution :** fiche unique pour la préparation partagée, références courtes et index fédéré. **Alternatives/contrainte :** les seuls rapports d'audit ne donnent pas le point d'entrée propriétaire; aucune duplication d'équations ou de runtime n'est autorisée. **Résultat/performance/validité :** traçabilité, sans changement de tokens fonctionnels ni nouvelle qualification physique. **Régression possible :** liens et index périmés. **Tests/preuves :** comparaison des tokens et contrôles documentaires communs. **Statut :** implémentation documentaire, vérification à consulter dans le compte rendu commun.

## F. Optimisations et compromis

| Optimisation                         | Objectif                                                                       | Gain mesuré                                                           | Compromis                                                                          | Statut                                   |
| ------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------- |
| Réutiliser une sous-région d'ancêtre | Continuer le raffinement géométrique sans demander un niveau source inexistant | `COST_NOT_ISOLATED`                                                   | Le détail géométrique supplémentaire n'ajoute pas de mesure fine au DEM            | Active                                   |
| Génération configurée                | Fournir des niveaux interpolés selon le contrat de source                      | `COST_NOT_ISOLATED`                                                   | Préparation/mémoire, détail interpolé plutôt que mesuré                            | Active si configurée                     |
| Registration point                   | Utiliser les arêtes déjà publiées sans chargement des huit voisins             | Différence de demandes démontrable par tests, pas de gain GPU chiffré | Contrat de source différent de area, conversion arbitraire interdite               | Active sur source déclarée point         |
| Workers et transfert de buffers      | Répartir le décodage CPU et éviter les copies admissibles                      | `COST_NOT_ISOLATED`                                                   | Gestion de disponibilité, erreurs et travail worker pouvant finir après annulation | Option disponible                        |
| Ranges de quadrants                  | Donner des bornes informées aux enfants avant chargement propre                | `COST_NOT_ISOLATED`                                                   | Bornes issues de l'ancêtre, distinctes de mesures détaillées                       | Active si `ChildHeightRanges` est fourni |

L'audit ne contient pas un identifiant `O##` de gain de préparation DEM isolé. `O14` concerne la couverture runtime et son effet sur le terrain rendu, pas une optimisation propre du décodeur. Les gains du transport, du SH ou du stockage incident ne sont pas transférés à ce composant.

## G. Performances

**Coût isolé : `COST_NOT_ISOLATED`.** Les durées CPU de l'application et les timestamps du renderer ne chronomètrent pas séparément la décompression PNG, le décodage en hauteurs, le stitching, l'interpolation et les normales. Aucune durée GPU n'est attribuée à ces fonctions CPU.

Le corpus d'audit est identifié par [les configurations et le manifeste DEM](../../../atmosphere-core-r1-7-1/audit/runs/2026-11-15-arc-matrix/RUN.json) et `DEM-manifest.json` dans le même dossier : 3480 entrées provider avec bytes et SHA-256 vérifiés. Le corpus n'est pas une surface synthétique et reste externe aux captures Git de cet audit. La matrice conserve scènes, poses, GPU et p50/p95/p99; ceux-ci appartiennent à la charge applicative complète.

Une grille Float32 à un canal représente logiquement `4 * width * height` octets de données, auxquels s'ajoutent métadonnées, rasters stitchés et caches. Cette formule statique n'est ni un chronométrage ni une mesure du GPU. Les nombres de sommets/fragments et dispatchs relèvent de `SPX-GEO-001` et des consommateurs atmosphériques.

## H. Tests et preuves

- `tests/codecs.test.ts`, `tests/dem-infos.test.ts`, `tests/dem-decoder.test.ts`, `tests/terrarium-encoder.test.ts` : encodages, grilles, données manquantes et port local/worker.
- `tests/dem-pyramid.test.ts` : ranges des enfants, surzoom par ancêtre, niveaux générés, gradients continus et annulation du chargement.
- `tests/raster-registration.test.ts` : area, point, déplacement du mauvais contrat et déclaration provider.
- `tests/mapzen-normals.test.ts` : contrat de normales et encodage associé.
- `../raster/tests/raster-pyramid.test.ts`, `stitched-raster-grids.test.ts`, `prestitched-rasters.test.ts`, `resampling.test.ts`, `sampling.test.ts`, `png-data-decoder.test.ts` : arêtes, registration, sous-régions, interpolation et conservation des valeurs.
- [Preuves de performance et limites](../../../atmosphere-core-r1-7-1/REGRESSION_CAUSALITY.md) : aucune assimilation entre profondeur native, classification d'éclairage et nouvelle hauteur source.

Commande existante : `npm run check` à la racine de terrain-core après la build de son propriétaire de tuiles. Aucune installation n'est autorisée implicitement pour ce travail. La présence d'un test ne remplace pas le compte rendu de son exécution.

## I. Problèmes et questions ouvertes

`RATIONALE_UNKNOWN` pour les calibrages initiaux non documentés d'interpolation, de cache et de résolution. `COST_NOT_ISOLATED` pour chaque étape de préparation. La précision absolue et le datum d'une source DEM demandent une qualification indépendante. Une source area mal déclarée demeure un risque systématique de positionnement. Les racines, les limites et les manques ne doivent pas être masqués par une interpolation choisie pour la couleur du terrain.

L'altitude négative valide reste une donnée; l'inadmissibilité d'un lecteur atmosphérique se documente dans son propriétaire. Les futures conversions de surface ou spécialisations sol/orbite sont des hypothèses à qualifier, pas des fonctionnalités déjà autorisées. Avant tout changement lire cette fiche, les ADR associés et [le CHANGE_IMPACT initial](../../../atmosphere-core-r1-7-1/docs/architecture/changes/2026-11-15-memory-bootstrap.md). Chaque modification de code livre sa documentation et son entrée historique dans le même ensemble de changements et commit.
