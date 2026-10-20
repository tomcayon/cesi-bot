# CESI Bot

Bot Discord qui affiche l'emploi du temps CESI de la semaine via la commande `/edt`.

> L'API ENT du CESI n'autorise un compte qu'à consulter **son propre** emploi du temps.
> Le bot gère donc **un seul identifiant** et **une seule classe**.

## Commandes

- `/edt [semaine]` — emploi du temps de la semaine (`semaine` = décalage : `0` cette semaine, `1` la suivante…).
- `/ping`, `/tempchannel`, `/cleargroup`, `/insulte`.

## Configuration

Copier `.env.example` vers `.env` et renseigner :

```ini
TOKEN=                 # token du bot Discord
CESI_NOM=MAALSI        # libellé affiché de la classe
CESI_CODE_PERSONNE=    # code personne CESI (visible dans l'URL de l'EDT)
CESI_EMAIL=            # identifiant ENT (prenom.nom@viacesi.fr)
CESI_PASSWORD=         # mot de passe ENT
# CESI_COOKIE=         # optionnel : cookie de session (court-circuite la connexion auto)
```

## Lancer en local

```bash
npm ci
node index.js
```

## Docker

Avec Docker Compose (build local) :

```bash
docker compose up -d --build
```

### Image GHCR

À chaque push sur `main`, GitHub Actions construit et publie l'image sur
le GitHub Container Registry (`.github/workflows/docker-publish.yml`).

Déployer l'image publiée :

```bash
docker run -d --name cesi-bot --restart unless-stopped \
  --env-file .env \
  ghcr.io/tomcayon/cesi-bot:latest
```

> Après le premier build, rendre le package GHCR public (ou se connecter avec
> `docker login ghcr.io`) depuis l'onglet **Packages** du dépôt GitHub.
