# Radhes Launcher

Launcher Minecraft privé pour un groupe d'amis : connexion Microsoft, Minecraft + Fabric, mods synchronisés, mises à jour automatiques.

## Ce que fait le launcher

1. Le joueur se connecte avec son compte Microsoft (il doit posséder Minecraft Java).
2. Il clique sur **Jouer**. Le launcher :
   - télécharge la liste des mods (`manifest.json`) ;
   - installe Java, Minecraft et Fabric depuis les serveurs officiels (seulement la première fois) ;
   - ajoute, met à jour ou supprime les mods pour que tout le monde ait exactement la même liste ;
   - lance le jeu.
3. Au démarrage, le launcher vérifie s'il existe une nouvelle version de lui-même et l'installe tout seul.

Les fichiers du jeu sont rangés dans `%APPDATA%\.radhes-launcher` (séparé de ton `.minecraft` habituel).
Attention : le dossier `mods` de ce dossier est géré par le launcher. Tout mod ajouté à la main y est supprimé.

---

## Mise en place (à faire une seule fois)

### 1. Installer Node.js et Git
Dans PowerShell :
```
winget install OpenJS.NodeJS.LTS
winget install Git.Git
```
Ensuite, redémarre le PC.

### 2. Créer le dépôt GitHub
1. Crée un compte sur https://github.com.
2. Crée un dépôt **public** nommé `radhes-launcher`. Il doit être public pour que les mises à jour fonctionnent chez tes amis.
3. Dans `package.json`, mets ton nom d'utilisateur GitHub dans `owner` (déjà fait : `vgcommunautaire`).
4. Envoie le code dans le dépôt (au moins un commit est nécessaire).

### 3. Créer l'application Microsoft (Azure)
1. Va sur https://portal.azure.com, puis **Inscriptions d'applications** → **Nouvelle inscription**.
2. Nom : `Radhes Launcher`. Types de comptes : **Comptes Microsoft personnels uniquement**.
3. URI de redirection : plateforme **Client public/natif (mobile et bureau)**, adresse :
   `https://login.microsoftonline.com/common/oauth2/nativeclient`
4. Copie l'**ID d'application (client)** et colle-le dans `src/main/config.js` (`AZURE_CLIENT_ID`).
5. **Important :** les nouvelles applications doivent être autorisées par Mojang avant de pouvoir se connecter à Minecraft. Remplis le formulaire « AppID Review » : https://aka.ms/mce-reviewappid (il demande l'ID d'application **et** l'ID de l'annuaire, ou « Tenant ID », tous deux visibles sur la page de l'application Azure). Les demandes sont examinées une fois par semaine. Le nom de l'application ne doit contenir ni « Minecraft », ni « Mojang », ni « Microsoft », ni « Xbox ». Tant que ce n'est pas validé, la connexion s'arrête avec le message « Mojang a refusé la connexion ».

### 4. Installer les dépendances
Dans le dossier du projet :
```
npm install
```

---

## Utilisation au quotidien

### Tester le launcher sur ton PC
```
npm start
```

### Mettre à jour la liste des mods
1. Mets les `.jar` dans le dossier `mods/` du projet (ajoute, remplace ou supprime).
2. Si besoin, change la version de Minecraft dans `modpack.json`.
3. Lance :
```
npm run publish-mods
```
Il faut un jeton GitHub. Crée-le sur https://github.com/settings/tokens (type « Fine-grained », accès au dépôt, droit **Contents : Read and write**), puis, dans PowerShell :
```
$env:GH_TOKEN = "ton_jeton"
npm run publish-mods
```

Les mods présents sur Modrinth sont téléchargés directement depuis Modrinth par les joueurs. Ils ne sont pas ré-hébergés. Les autres (ton mod perso, par exemple) sont envoyés dans la release GitHub `mods`.

Pour voir le résultat sans rien envoyer : `npm run publish-mods -- --essai`

### Publier une nouvelle version du launcher
1. Augmente `version` dans `package.json` (par exemple `1.0.0` → `1.0.1`).
2. Lance :
```
$env:GH_TOKEN = "ton_jeton"
npm run release
```
Les launchers de tes amis se mettront à jour au prochain démarrage.

La toute première fois, envoie à tes amis le fichier `dist\Radhes Launcher Setup x.y.z.exe`. Windows affichera « éditeur inconnu » : clique sur **Informations complémentaires**, puis **Exécuter quand même**.

---

## En cas de problème
- Réglages → **Ouvrir les journaux** : envoie le fichier `launcher.log`.
- Si le jeu plante : `%APPDATA%\.radhes-launcher\logs\jeu-launcher.log`.
- Réglages → **Vérifier et réparer les fichiers** retélécharge tout fichier abîmé.
