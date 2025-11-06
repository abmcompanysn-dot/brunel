/**
 * ==================================================================
 * GESTIONNAIRES DE REQUÊTES (doGet, doPost, doOptions)
 * ==================================================================
 */

/**
 * Gère les requêtes GET.
 * Toutes les actions sont maintenant gérées par doPost pour simplifier.
 */
function doGet(e) {
  return corsify({ status: 'API en ligne', message: 'Veuillez utiliser des requêtes POST.' });
}

/**
 * Point d'entrée UNIQUE pour toutes les actions de l'API.
 */
function doPost(e) {
  try {
    const userEmail = Session.getActiveUser().getEmail();
    const action = e.parameter.action;
    const payload = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
    let result;

    switch (action) {
      case 'handleLeadCapture': result = handleLeadCapture(payload); break;
      case 'saveProfile': result = saveProfile(payload); break;
      case 'registerUser': result = registerUser(payload.email, payload.password); break;
      case 'loginUser': result = loginUser(payload.email, payload.password); break;
      case 'logout': result = logout(); break;
      case 'updateOnboardingData': result = updateOnboardingData(payload); break;
      case 'syncCart':
        Logger.log('Panier synchronisé: ' + JSON.stringify(payload));
        result = { success: true };
        break;
      case 'createCheckoutSession': result = createCheckoutSession(payload); break;
      case 'setModuleState': result = setModuleState(payload.moduleName, payload.isEnabled); break;
      case 'generateGoogleWalletPass': result = generateGoogleWalletPass(); break;
      case 'trackView': result = trackView(payload.profileUrl, payload.source); break;
      case 'getProfileData': result = getProfileData(e.parameter.user); break;
      case 'getDashboardData': result = getDashboardData(); break;
      case 'getDashboardStats': result = getDashboardStats(); break;
      case 'exportLeadsAsCSV':
        // Cas spécial : renvoie du texte brut, pas du JSON.
        const csvOutput = ContentService.createTextOutput(exportLeadsAsCSV()).setMimeType(ContentService.MimeType.TEXT);
        csvOutput.addHttpHeader('Access-Control-Allow-Origin', '*');
        return csvOutput;
      default:
        result = { error: 'Action POST non reconnue.' };
        break;
    }
    logAction(action, 'SUCCESS', `Action exécutée avec succès.`, userEmail);
    return corsify(result);
  } catch (err) {
    const errorMessage = `Erreur dans l'action '${e.parameter.action}': ${err.message} (Ligne: ${err.lineNumber})`;
    logAction(e.parameter.action, 'ERROR', errorMessage, Session.getActiveUser().getEmail(), 'Vérifiez que les données envoyées sont correctes et que les feuilles Google Sheets ne sont pas corrompues. Si l\'erreur persiste, contactez le support technique.');
    return corsify({ error: "Une erreur interne est survenue. L'incident a été enregistré." });
  }
}

/**
 * Gère les requêtes "preflight" CORS envoyées par les navigateurs.
 */
function doOptions(e) {
  return corsify(null, true);
}

/**
 * ==================================================================
 * FONCTION UTILITAIRE CORS
 * ==================================================================
 */

/**
 * Ajoute les en-têtes CORS nécessaires à une réponse.
 * @param {Object|null} data - L'objet de données à renvoyer en JSON.
 * @param {boolean} [isOptions=false] - S'il s'agit d'une requête OPTIONS.
 * @returns {ContentService.TextOutput} La réponse formatée.
 */
function corsify(data, isOptions = false) {
  // La méthode la plus fiable pour éviter les erreurs "TypeError" est de ne pas utiliser
  // addHttpHeader ou setHeaders, mais de renvoyer directement un objet JSON.
  // Le moteur Apps Script gère les en-têtes correctement avec cette approche.
  let response = {
    headers: { 'Access-Control-Allow-Origin': '*' }
  };
  if (isOptions) {
    response.headers['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * ==================================================================
 * LOGIQUE DE L'APPLICATION
 * ==================================================================
 */

/**
 * Ajoute un menu personnalisé à la feuille de calcul pour faciliter la configuration.
 */
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('Brunel Admin')
      .addItem('Vérifier et Réparer la Structure', 'verifyAndFixSheetStructure')
      .addItem('1. Initialiser les feuilles', 'setupSpreadsheet')
      .addToUi();
}

/**
 * Crée les feuilles de calcul nécessaires avec leurs en-têtes si elles n'existent pas.
 * C'est la fonction qui initialise la structure de données.
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsToCreate = [
    { name: 'Utilisateurs', headers: ['ID_Unique', 'Email', 'ID_Entreprise', 'Role', 'URL_Profil', 'ID_Cartes_NFC', 'Onboarding_Status'] },
    { name: 'Profils', headers: ['ID_Utilisateur', 'Nom_Complet', 'Profession', 'Compagnie', 'Location', 'Couleur_Theme', 'URL_Photo', 'URL_Couverture', 'Liens_Sociaux_JSON', 'Lead_Capture_Actif', 'CV_Actif', 'CV_Data', 'API_KEY_IMGBB', 'WALLET_ISSUER_ID', 'WALLET_CLASS_ID', 'WALLET_SERVICE_EMAIL', 'WALLET_PRIVATE_KEY'] },
    { name: 'Historique_Actions', headers: ['Timestamp', 'Action', 'Statut', 'Message', 'Utilisateur_Email', 'Suggestion_Correction'] },
    { name: 'Prospects', headers: ['ID_Profil_Source', 'Date_Capture', 'Nom_Prospect', 'Contact_Prospect', 'Message_Note'] },
    { name: 'Statistiques', headers: ['ID_Profil', 'Date_Heure', 'Source'] },
    // L'onglet Commandes n'était pas dans la nouvelle spec, mais on peut le garder si besoin.
    // { name: 'Commandes NFC', headers: ['ID_Commande', 'ID_Utilisateur', 'Type_Carte', 'Quantite', 'Date_Commande', 'Statut'] },
  ];

  sheetsToCreate.forEach(sheetInfo => {
    let sheet = ss.getSheetByName(sheetInfo.name);
    if (!sheet) {
      sheet = ss.insertSheet(sheetInfo.name);
      sheet.getRange(1, 1, 1, sheetInfo.headers.length).setValues([sheetInfo.headers]).setFontWeight('bold');
      SpreadsheetApp.flush(); // Applique les changements
      Logger.log(`Feuille "${sheetInfo.name}" créée.`);
      
      // Ajout de données d'exemple pour les statistiques pour tester le graphique
      if (sheetInfo.name === 'Statistiques' && sheet.getLastRow() < 2) {
        const exampleData = [
          ['profil_test', new Date(), 'NFC'],
          ['profil_test', new Date(), 'NFC'],
          ['profil_test', new Date(), 'QR Code'],
          ['profil_test', new Date(), 'Lien'],
          ['profil_test', new Date(), 'NFC']
        ];
        sheet.getRange(2, 1, exampleData.length, exampleData[0].length).setValues(exampleData);
      }
    } else {
      Logger.log(`La feuille "${sheetInfo.name}" existe déjà.`);
    }
  });
  
  SpreadsheetApp.getUi().alert('Initialisation terminée ! Les feuilles de calcul sont prêtes.');
}

/**
 * Vérifie que toutes les feuilles et colonnes nécessaires existent, et les crée si elles sont manquantes.
 * C'est une fonction de "migration" ou de "réparation" de la base de données.
 */
function verifyAndFixSheetStructure() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  let corrections = [];

  const requiredSheets = [
    { name: 'Utilisateurs', headers: ['ID_Unique', 'Email', 'ID_Entreprise', 'Role', 'URL_Profil', 'ID_Cartes_NFC', 'Onboarding_Status'] },
    { name: 'Profils', headers: ['ID_Utilisateur', 'Nom_Complet', 'Profession', 'Compagnie', 'Location', 'Couleur_Theme', 'URL_Photo', 'URL_Couverture', 'Liens_Sociaux_JSON', 'Lead_Capture_Actif', 'CV_Actif', 'CV_Data', 'API_KEY_IMGBB', 'WALLET_ISSUER_ID', 'WALLET_CLASS_ID', 'WALLET_SERVICE_EMAIL', 'WALLET_PRIVATE_KEY'] },
    { name: 'Historique_Actions', headers: ['Timestamp', 'Action', 'Statut', 'Message', 'Utilisateur_Email', 'Suggestion_Correction'] },
    { name: 'Prospects', headers: ['ID_Profil_Source', 'Date_Capture', 'Nom_Prospect', 'Contact_Prospect', 'Message_Note'] },
    { name: 'Statistiques', headers: ['ID_Profil', 'Date_Heure', 'Source'] },
  ];

  requiredSheets.forEach(sheetInfo => {
    let sheet = ss.getSheetByName(sheetInfo.name);
    if (!sheet) {
      // La feuille n'existe pas, on la crée complètement.
      sheet = ss.insertSheet(sheetInfo.name);
      sheet.getRange(1, 1, 1, sheetInfo.headers.length).setValues([sheetInfo.headers]).setFontWeight('bold');
      corrections.push(`Feuille "${sheetInfo.name}" créée.`);
    } else {
      // La feuille existe, on vérifie les colonnes.
      const currentHeaders = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      sheetInfo.headers.forEach(requiredHeader => {
        if (!currentHeaders.includes(requiredHeader)) {
          // La colonne est manquante, on l'ajoute à la fin.
          sheet.getRange(1, sheet.getLastColumn() + 1).setValue(requiredHeader).setFontWeight('bold');
          corrections.push(`Colonne "${requiredHeader}" ajoutée à la feuille "${sheetInfo.name}".`);
        }
      });
    }
  });

  if (corrections.length > 0) {
    ui.alert('Vérification terminée', 'Les corrections suivantes ont été apportées :\n- ' + corrections.join('\n- '), ui.ButtonSet.OK);
  } else {
    ui.alert('Vérification terminée', 'Aucune correction nécessaire. Votre structure est à jour.', ui.ButtonSet.OK);
  }
}

/**
 * Enregistre une action ou une erreur dans la feuille 'Historique_Actions'.
 * @param {string} action - Le nom de l'action effectuée (ex: 'saveProfile').
 * @param {string} status - 'SUCCESS' ou 'ERROR'.
 * @param {string} message - Le message détaillé de l'événement.
 * @param {string} userEmail - L'email de l'utilisateur effectuant l'action.
 * @param {string} [suggestion=''] - Une suggestion de correction en cas d'erreur.
 */
function logAction(action, status, message, userEmail, suggestion = '') {
  try {
    const logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Historique_Actions');
    if (logSheet) {
      logSheet.appendRow([new Date(), action, status, message, userEmail, suggestion]);
    }
  } catch (e) {
    Logger.log(`Impossible d'écrire dans la feuille d'historique: ${e.message}`);
  }
}

/**
 * Récupère les statistiques de vues depuis la feuille "Statistiques",
 * les agrège par source et les renvoie au format JSON pour Chart.js.
 * * @returns {Object} Un objet contenant les labels et les données pour le graphique.
 */
function getDashboardStats() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Statistiques');
    if (!sheet) {
      throw new Error('La feuille "Statistiques" est introuvable. Veuillez exécuter l\'initialisation.');
    }
    
    const data = sheet.getRange('C2:C').getValues().flat().filter(String); // Récupère toutes les sources de vue (colonne C maintenant)
    
    const counts = {
      'NFC': 0,
      'QR Code': 0,
      'Lien': 0
    };

    data.forEach(source => {
      if (counts.hasOwnProperty(source)) {
        counts[source]++;
      }
    });

    return {
      labels: Object.keys(counts),
      data: Object.values(counts)
    };

  } catch (e) {
    Logger.log(e);
    return { error: e.message };
  }
}

/**
 * Vérifie si l'utilisateur Google actif existe dans la feuille 'Utilisateurs'.
 * S'il n'existe pas, le crée avec un rôle par défaut.
 * @returns {Object} Les informations de l'utilisateur.
 */
function authenticateUser() {
  const email = Session.getActiveUser().getEmail();
  Logger.log(`Authentification pour : ${email}`);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Utilisateurs');
  const usersData = userSheet.getDataRange().getValues();
  const headers = usersData[0].slice(); // Copie des en-têtes
  const users = usersData.slice(1); // Données sans en-têtes
  const emailCol = headers.indexOf('Email');

  let userRow = users.find(row => row[emailCol] === email);

  if (!userRow) {
    Logger.log(`Nouvel utilisateur : ${email}. Création du compte.`);
    const newId = 'user_' + Utilities.getUuid();
    const profileUrl = email.split('@')[0].replace(/[^a-z0-9]/gi, '') + Math.floor(Math.random() * 1000);
    
    userRow = [newId, email, '', 'Particulier', profileUrl, '[]', 'ONBOARDING_STARTED'];
    userSheet.appendRow(userRow);

    // Créer un profil de base associé
    const profileSheet = ss.getSheetByName('Profils');
    profileSheet.appendRow([newId, email.split('@')[0], '', '', '', '#007BFF', '', '', '[]', 'NON', 'NON', '']);
    
    SpreadsheetApp.flush();

    // Pour la redirection côté client, on ajoute un flag
    // NOTE: isNewRegistration n'est pas défini dans ce code snippet, 
    // cette partie pourrait nécessiter une adaptation si vous utilisez un système de login externe.
    if (isNewRegistration) {
      return { success: true, newUser: true };
    }
  }

  // Convertir le tableau en objet pour une manipulation facile
  const userObject = headers.reduce((obj, header, index) => {
    obj[header] = userRow[index];
    return obj;
  }, {});

  return userObject;
}

/**
 * Fonction centrale pour charger toutes les données du tableau de bord en un seul appel.
 * @returns {Object} Un objet contenant toutes les données nécessaires pour le dashboard.
 */
function getDashboardData() {
  try {
    const user = authenticateUser();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // Récupérer les données du profil
    const profilesSheet = ss.getSheetByName('Profils');
    const profilesData = profilesSheet.getDataRange().getValues();
    const profilesHeaders = profilesData.shift();
    const profileUserIdCol = profilesHeaders.indexOf('ID_Utilisateur');
    const profileRow = profilesData.find(row => row[profileUserIdCol] === user.ID_Unique);
    const profile = profilesHeaders.reduce((obj, header, index) => {
      obj[header] = profileRow ? profileRow[index] : '';
      return obj;
    }, {});

    // Récupérer les prospects
    const prospectsSheet = ss.getSheetByName('Prospects');
    // Récupère uniquement les 4 premières colonnes (A à D) et filtre les lignes non vides
    const prospectsData = prospectsSheet.getRange('A2:E').getValues() 
      .filter(row => row[0] === user.ID_Unique) // Filtrer par ID_Profil_Source (colonne A)
      // Formater pour le frontend (les indices sont pour les colonnes 0=ID_Profil_Source, 1=Date_Capture, 2=Nom_Prospect, 3=Contact_Prospect, 4=Message_Note)
      .map(row => ({ id: row[0], date: row[1], nom: row[2], contact: row[3], note: row[4] })) 
      .slice(0, 10); // Limiter aux 10 derniers

    // Construire l'URL de base de l'application web
    const appUrl = ScriptApp.getService().getUrl();

    return {
      user: user,
      profile: profile,
      prospects: prospectsData,
      appUrl: appUrl
    };
  } catch (e) {
    Logger.log(`Erreur dans getDashboardData: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * Récupère toutes les données d'un profil pour l'affichage public.
 * @param {string} profileUrl - L'URL unique du profil (ex: 'mon-nom').
 * @returns {Object} Un objet contenant toutes les données du profil à afficher.
 */
function getProfileData(profileUrl) {
  try {
    Logger.log(`Récupération des données pour le profil : ${profileUrl}`);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const usersSheet = ss.getSheetByName('Utilisateurs');
    const profilesSheet = ss.getSheetByName('Profils');

    if (!usersSheet || !profilesSheet) {
      throw new Error("Les feuilles 'Utilisateurs' ou 'Profils' sont introuvables.");
    }

    // Lire toutes les données pour éviter les appels multiples
    const usersData = usersSheet.getDataRange().getValues();
    const profilesData = profilesSheet.getDataRange().getValues();

    // Trouver les index des colonnes par leur nom pour plus de robustesse
    const usersHeaders = usersData.shift(); // Retire et retourne la ligne d'en-tête
    const urlProfilCol = usersHeaders.indexOf('URL_Profil');
    const userIdCol = usersHeaders.indexOf('ID_Unique');
    const userEmailCol = usersHeaders.indexOf('Email');

    // 1. Trouver l'utilisateur par son URL de profil
    const userRow = usersData.find(row => row[urlProfilCol] === profileUrl);

    if (!userRow) {
      Logger.log(`Aucun utilisateur trouvé pour l'URL : ${profileUrl}`);
      return { error: "Profil non trouvé." };
    }

    const userId = userRow[userIdCol];

    // 2. Trouver le profil correspondant avec l'ID de l'utilisateur
    const profilesHeaders = profilesData.shift();
    const profileUserIdCol = profilesHeaders.indexOf('ID_Utilisateur');
    const profileRow = profilesData.find(row => row[profileUserIdCol] === userId);

    if (!profileRow) {
      Logger.log(`Aucun profil trouvé pour l'ID utilisateur : ${userId}`);
      return { error: "Données de profil non trouvées." };
    }

    // 3. Construire l'objet de données à retourner
    // Cette méthode transforme la ligne de données en un objet clé-valeur
    const profileDataObject = profilesHeaders.reduce((obj, header, index) => {
      obj[header] = profileRow[index];
      return obj;
    }, {});

    // Ajouter des informations de l'utilisateur si nécessaire (ex: email)
    profileDataObject.Email = userRow[userEmailCol];

    return profileDataObject;

  } catch (e) {
    Logger.log(`Erreur dans getProfileData: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * Met à jour le profil de l'utilisateur connecté avec les données du formulaire de l'éditeur.
 * @param {Object} data - Un objet contenant les données du formulaire.
 */
function saveProfile(data) {
  try {
    const user = authenticateUser();
    const profileSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Profils');
    const profilesData = profileSheet.getDataRange().getValues();
    const headers = profilesData.shift();
    const userIdCol = headers.indexOf('ID_Utilisateur');

    const rowIndex = profilesData.findIndex(row => row[userIdCol] === user.ID_Unique);
    
    if (rowIndex !== -1) {
      // Mettre à jour la ligne existante (l'index est 0-based, mais la plage est 1-based, +2 pour la ligne de données)
      const rowToUpdate = rowIndex + 2;
      // Mettre à jour les valeurs en fonction des en-têtes
      headers.forEach((header, index) => {
        if (data.hasOwnProperty(header)) {
          profileSheet.getRange(rowToUpdate, index + 1).setValue(data[header]);
        }
      });
      Logger.log(`Profil pour ${user.Email} mis à jour.`);
      return { success: true, message: "Profil sauvegardé avec succès." };
    }
    return { success: false, message: "Profil non trouvé pour la mise à jour." };
  } catch (e) {
    Logger.log(`Erreur dans saveProfile: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * Enregistre une vue de profil dans la feuille 'Statistiques'.
 * @param {string} profileUrl - L'URL du profil qui a été vu.
 * @param {string} source - La source de la vue ('NFC', 'QR', 'Lien').
 */
function trackView(profileUrl, source) {
  try {
    const statsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Statistiques');
    statsSheet.appendRow([profileUrl, new Date(), source]);
    Logger.log(`Vue enregistrée pour ${profileUrl} depuis ${source}`);
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

/**
 * Enregistre un nouveau prospect depuis le formulaire de la page publique.
 * @param {Object} leadData - Données du prospect (nom, message, etc.) et ID du profil source.
 */
function handleLeadCapture(leadData) {
  try {
    if (!leadData || !leadData.profileUrl || !leadData.name || !leadData.contact) {
      throw new Error("Données de prospect incomplètes.");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const usersSheet = ss.getSheetByName('Utilisateurs');
    const usersData = usersSheet.getDataRange().getValues();
    const urlCol = usersData[0].indexOf('URL_Profil');
    const idCol = usersData[0].indexOf('ID_Unique');

    const userRow = usersData.find(row => row[urlCol] === leadData.profileUrl);
    if (!userRow) throw new Error("Profil source introuvable.");

    const profileOwnerId = userRow[idCol];

    const prospectsSheet = ss.getSheetByName('Prospects');
    prospectsSheet.appendRow([profileOwnerId, new Date(), leadData.name, leadData.contact, leadData.message]);
    Logger.log(`Nouveau prospect capturé pour ${profileOwnerId}: ${leadData.name}`);
    return { success: true };
  } catch (e) {
    Logger.log(`Erreur dans handleLeadCapture: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Associe un nouvel ID de carte NFC à l'utilisateur connecté.
 * @param {string} nfcId - L'identifiant unique de la carte NFC.
 */
function linkNfcCard(nfcId) {
  const user = authenticateUser();
  const userSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Utilisateurs');
  // Logique à implémenter...
  Logger.log(`Liaison de la carte NFC ${nfcId} à l'utilisateur ${user.ID_Unique}`);
}

/**
 * Met à jour l'état d'un module (CV, Lead Capture) pour l'utilisateur connecté.
 * @param {string} moduleName - Le nom du module ('CV_Actif' ou 'Lead_Capture_Actif').
 * @param {boolean} isEnabled - L'état du module.
 */
function setModuleState(moduleName, isEnabled) {
  try {
    const dataToSave = {};
    dataToSave[moduleName] = isEnabled ? 'OUI' : 'NON';
    saveProfile(dataToSave); // Réutilise la fonction saveProfile pour mettre à jour
    Logger.log(`Module ${moduleName} mis à jour à ${isEnabled} pour l'utilisateur.`);
  } catch(e) {
    Logger.log(`Erreur dans setModuleState: ${e.message}`);
  }
}

/**
 * Exporte les prospects de l'utilisateur connecté au format CSV.
 * @returns {string} Une chaîne de caractères contenant les données au format CSV.
 */
function exportLeadsAsCSV() {
  try {
    const user = authenticateUser();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const prospectsSheet = ss.getSheetByName('Prospects');
    const data = prospectsSheet.getDataRange().getValues();
    const headers = data.shift();
    
    const userProspects = data.filter(row => row[0] === user.ID_Unique);

    let csvContent = headers.join(',') + '\n';
    userProspects.forEach(row => {
      // Les cellules sont entourées de guillemets et les guillemets internes sont échappés pour un bon format CSV
      csvContent += row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',') + '\n';
    });
    return csvContent;
  } catch (e) {
    return "Erreur lors de la génération du CSV: " + e.message;
  }
}
/**
 * Met à jour les données et le statut de l'utilisateur pendant l'onboarding.
 * @param {Object} request - Contient l'étape et les données à sauvegarder.
 */
function updateOnboardingData(request) {
  try {
    const user = authenticateUser();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName('Utilisateurs');
    const usersData = userSheet.getDataRange().getValues();
    const userHeaders = usersData.shift();
    const userIdCol = userHeaders.indexOf('ID_Unique');
    const userRowIndex = usersData.findIndex(row => row[userIdCol] === user.ID_Unique);

    if (userRowIndex === -1) throw new Error("Utilisateur non trouvé pour la mise à jour.");
    const sheetRow = userRowIndex + 2;

    if (request.step === 'final') {
      const statusCol = userHeaders.indexOf('Onboarding_Status') + 1;
      userSheet.getRange(sheetRow, statusCol).setValue('COMPLETED');
    } else if (request.data) {
      // Sauvegarder les données dans la feuille Profils via saveProfile
      if (Object.keys(request.data).some(k => ['Nom_Complet', 'Profession', 'Compagnie', 'Location'].includes(k))) {
        saveProfile(request.data);
      }
      // Sauvegarder les données dans la feuille Utilisateurs
      if (request.data.Role) {
        const roleCol = userHeaders.indexOf('Role') + 1;
        userSheet.getRange(sheetRow, roleCol).setValue(request.data.Role);
      }
    }
    return { success: true };
  } catch (e) {
    Logger.log(`Erreur dans updateOnboardingData: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * ==================================================================
 * LOGIQUE POUR GOOGLE WALLET
 * ==================================================================
 * Prérequis :
 * 1. Créez une "Classe de carte" dans la Google Pay & Wallet Console (https://pay.google.com/business/console).
 * - Choisissez "Carte générique".
 * - Notez l'ID de la classe (ex: "123456789.MyPassClass").
 * 2. Créez un compte de service dans Google Cloud avec le rôle "Éditeur de l'API Wallet".
 * - Téléchargez la clé JSON.
 * 3. Dans l'éditeur Apps Script, allez dans "Paramètres du projet" > "Propriétés du script".
 * - Ajoutez 3 propriétés :
 * - GOOGLE_WALLET_ISSUER_ID : (ID de l'émetteur, trouvé dans la console Wallet)
 * - GOOGLE_WALLET_CLASS_ID  : (ID de la classe de carte que vous avez créée)
 * - SERVICE_ACCOUNT_PRIVATE_KEY : (La clé privée de votre fichier JSON, commençant par "-----BEGIN PRIVATE KEY-----...")
 * - SERVICE_ACCOUNT_EMAIL : (L'email de votre compte de service)
 */
function generateGoogleWalletPass() {
  try {
    const user = authenticateUser();
    const profile = getDashboardData().profile; // Récupère les données du profil
    
    const issuerId = profile.WALLET_ISSUER_ID;
    const classId = profile.WALLET_CLASS_ID;
    const serviceAccountEmail = profile.WALLET_SERVICE_EMAIL;
    const privateKey = profile.WALLET_PRIVATE_KEY;

    if (!issuerId || !classId || !serviceAccountEmail || !privateKey) {
      throw new Error("Les informations pour Google Wallet ne sont pas configurées dans l'onglet Intégrations.");
    }

    const objectId = `${issuerId}.${user.ID_Unique.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;

    const passObject = {
      'id': objectId,
      'classId': classId,
      'genericType': 'GENERIC_TYPE_UNSPECIFIED',
      'hexBackgroundColor': profile.Couleur_Theme || '#007BFF',
      'logo': {
        'sourceUri': { 'uri': 'https://i.ibb.co/L6fKz3C/logo.png' } // URL de votre logo
      },
      'cardTitle': { 'defaultValue': { 'language': 'fr-FR', 'value': profile.Nom_Complet || 'Carte Brunel' } },
      'header': { 'defaultValue': { 'language': 'fr-FR', 'value': profile.Nom_Complet || user.Email } },
      'textModulesData': [
        { 'header': 'Email', 'body': user.Email, 'id': 'email' },
        { 'header': 'Profession', 'body': profile.Profession || 'Non spécifié', 'id': 'profession' }, // Ajouté
        { 'header': 'Compagnie', 'body': profile.Compagnie || 'Non spécifié', 'id': 'company' }, // Ajouté
        { 'header': 'Profil Public', 'body': `${ScriptApp.getService().getUrl()}?user=${user.URL_Profil}`, 'id': 'profile_url' } // Ajouté
      ],
      'linksModuleData': {
        'uris': [
          { 'uri': `${ScriptApp.getService().getUrl()}?user=${user.URL_Profil}`, 'description': 'Voir le profil complet', 'id': 'main_link' }
        ]
      }
    };

    const claims = {
      'iss': serviceAccountEmail,
      'aud': 'google',
      'typ': 'savetowallet',
      'origins': [],
      'payload': {
        'genericObjects': [passObject]
      }
    };

    const header = { 'alg': 'RS256', 'typ': 'JWT' };
    const toSign = `${Utilities.base64EncodeWebSafe(JSON.stringify(header))}.${Utilities.base64EncodeWebSafe(JSON.stringify(claims))}`;
    const signature = Utilities.computeRsaSha256Signature(toSign, privateKey);
    const signedJwt = `${toSign}.${Utilities.base64EncodeWebSafe(signature)}`;

    return { success: true, jwt: signedJwt };

  } catch (e) {
    Logger.log(e);
    return { success: false, error: e.message };
  }
}