# Questions retenues pour v4-evp-fiabilite-nir

5 questions produites ; 1 retenues pour le propriétaire ; 4 tranchées par défaut et inscrites au registre.

### 1. Q-EVP-14 : Où signaler la clé de contrôle fausse d'un NIR côté PayFit

Situation : Une collaboratrice de la société Alpha porte dans PayFit un NIR dont la clé de contrôle est fausse. Une ligne Aqoona d'une autre salariée des crèches d'Alpha porte un NIR de clé juste. Une lecture de PayFit puis une lecture d'Aqoona sont lancées.

- **A (défaut). Contrôler les NIR de PayFit pendant la lecture d'Aqoona, pour les seules sociétés dont les NIR y sont lus, et signaler sur la source Aqoona.** L'anomalie « Clé de NIR PayFit incorrecte » (nom de la collaboratrice, société) est dans les anomalies d'Aqoona. La lecture PayFit ne lit toujours aucun NIR, donc rien ne se signale pour une société sans ligne Aqoona avec NIR. Coût : leger.
- **B. Faire lire et contrôler les NIR aussi par la lecture PayFit, pour toutes les sociétés, et signaler sur la source PayFit.** L'anomalie « Clé de NIR PayFit incorrecte » est dans les anomalies de PayFit pour toute société lisible, même sans ligne Aqoona avec NIR ; le NIR n'est toujours pas conservé. Coût : lourd. Questions ouvertes : la lecture PayFit lit le NIR de toutes les collaboratrices (portée requise, donnée personnelle manipulée plus largement), anomalie de portée aussi sur la source PayFit, règle rule-evp-aqoona-nir-lazy à rouvrir, risque de doublon d'anomalie avec la source Aqoona.

Répondre dans l'ordre : `cuisine arbitre "?"` ou `cuisine arbitre defaut`.
