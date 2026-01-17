/**
 * ==================================================================
 * CONFIGURATION CENTRALE DE L'APPLICATION
 * ==================================================================
 */
const CONFIG = {
  SENDER_NAME: "L'équipe Mahu", // Le nom qui apparaîtra comme expéditeur des e-mails.
  SENDER_EMAIL_ALIAS: "abmcompanysn@gmail.com" // OPTIONNEL: L'alias email à utiliser (ex: "contact@votre-site.com"). Doit être configuré dans Gmail > Paramètres > Comptes.
};

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
    const user = e.parameter.token ? getUserByToken(e.parameter.token) : null;
    const userEmail = user ? user.Email : 'anonyme';
    const action = e.parameter.action;
    
    // Amélioration de la gestion du payload pour accepter JSON ou paramètres plats
    let payload = {};
    if (e.parameter.payload) {
      try { payload = JSON.parse(e.parameter.payload); } catch (z) { payload = e.parameter; }
    } else {
      payload = e.parameter;
    }
    let result;

    switch (action) {
      case 'registerUser': result = registerUser(payload.email, payload.password, payload.enterpriseId); break;
      case 'loginUser': result = loginUser(payload.email, payload.password); break;
      case 'createCheckoutSession': result = createCheckoutSession(payload); break;
      case 'forgotPassword': result = forgotPassword(payload.email); break;
      case 'resetPassword': result = resetPassword(payload.token, payload.newPassword); break;
      case 'trackView': result = trackView(payload.profileUrl, payload.source); break;
      case 'handleLeadCapture': result = handleLeadCapture(payload); break;
      case 'getProfileData': result = getProfileData(e.parameter.user); break;
      case 'exportLeadsAsCSV':
        if (!user) throw new Error("Token d'authentification invalide ou manquant pour l'export.");
        // Cas spécial : renvoie du texte brut, pas du JSON.
        const csvOutput = ContentService.createTextOutput(exportLeadsAsCSV(user)).setMimeType(ContentService.MimeType.TEXT);
        csvOutput.addHttpHeader('Access-Control-Allow-Origin', '*');
        return csvOutput;
      default:
        // Actions nécessitant une authentification
        if (!user) throw new Error("Token d'authentification invalide ou manquant.");
        
        // Use a switch for authenticated actions for better readability and maintainability
        switch (action) {
          case 'getDashboardData':
            result = getDashboardData(user);
            break;
          case 'saveProfile': // L'action saveProfile peut maintenant recevoir des données de différentes manières
            result = saveProfile(payload, user);
            break;
          case 'saveProfileImage':
            result = saveProfileImage(payload, user);
            break;
          case 'saveDocument':
            result = saveDocument(payload, user);
            break;
          case 'deleteDocument':
            result = deleteDocument(payload.docId, user);
            break;
          case 'updateOnboardingData':
            result = updateOnboardingData(payload, user);
            break;
          case 'setModuleState':
            result = setModuleState(payload.moduleName, payload.isEnabled, user);
            break;
          case 'getPublicProfileUrl':
            result = getPublicProfileUrl(user);
            break;
          case 'generateGoogleWalletPass':
            result = generateGoogleWalletPass(user);
            break;
          case 'saveProduct':
          case 'deleteProduct':
            result = handleProductActions(action, payload, user);
            break;
          case 'logout':
            result = { success: true }; // Simple success for logout
            break;
          case 'syncCart':
            Logger.log(`Panier synchronisé pour ${user.Email}: ${JSON.stringify(payload)}`);
            result = { success: true };
            break;
          case 'linkNfcCard':
            result = linkNfcCard(payload.nfcId, user);
            break;
          case 'contactSupport':
            result = handleSupportMessage(payload, user);
            break;
          case 'createEmployee':
            result = createEmployee(payload, user);
            break;
          default:
            result = { error: 'Action POST non reconnue.' };
            break;
        }
        break;
    }
    logAction(action, 'SUCCESS', `Action exécutée avec succès.`, userEmail);
    return corsify(result);
  } catch (err) {
    const action = e.parameter.action || 'inconnue';
    const userIdentifier = e.parameter.token ? 'Token: ' + e.parameter.token : 'anonyme';
    const errorMessage = `Erreur dans l'action '${action}': ${err.message} (Ligne: ${err.lineNumber}, Fichier: ${err.fileName})`;
    
    // Enregistre l'erreur détaillée dans la feuille de calcul pour le débogage
    logAction(action, 'ERROR', errorMessage, userIdentifier, `Vérifiez que les données envoyées sont correctes. Payload reçu: ${JSON.stringify(e.parameter)}. Si l'erreur persiste, consultez les logs.`);
    
    // Renvoie une réponse d'erreur générique au client, mais avec les en-têtes CORS
    return corsify({ success: false, error: "Une erreur interne est survenue. L'incident a été enregistré." });
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
function corsify(data, e) {
  var json = JSON.stringify(data);
  var callback = e && e.parameter && e.parameter.callback;
  
  if (callback) {
    // Réponse JSONP : enveloppe dans une fonction callback
    return ContentService.createTextOutput(callback + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  } else {
    // Réponse JSON normale
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }
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
      .createMenu('Mahu Admin')
      .addItem('Vérifier et Réparer la Structure', 'verifyAndFixSheetStructure')
      .addItem('1. Initialiser les feuilles', 'setupSpreadsheet')
      .addSeparator()
      .addItem('Tester la notification CallMeBot', 'testCallMeBot')
      .addItem('Mettre à jour la feuille Support', 'verifyAndFixSheetStructure')
      .addToUi();
}

/**
 * Crée les feuilles de calcul nécessaires avec leurs en-têtes si elles n'existent pas.
 * C'est la fonction qui initialise la structure de données.
 */
function setupSpreadsheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetsToCreate = [
    { name: 'Utilisateurs', headers: ['ID_Unique', 'Email', 'Mot_De_Passe', 'ID_Entreprise', 'Role', 'URL_Profil', 'ID_Cartes_NFC', 'Onboarding_Status', 'Auth_Token', 'Token_Expiration', 'Reset_Token', 'Reset_Token_Expiration'] },
    { name: 'Profils', headers: ['ID_Utilisateur', 'Email', 'Nom_Complet', 'Telephone', 'Profession', 'Compagnie', 'Location', 'URL_Photo', 'URL_Couverture', 'Liens_Sociaux_JSON', 'Lead_Capture_Actif', 'CV_Actif', 'CV_Data', 'WALLET_ISSUER_ID', 'WALLET_CLASS_ID', 'WALLET_SERVICE_EMAIL', 'WALLET_PRIVATE_KEY', 'Mise_En_Page', 'Couleur_Theme', 'Cacher_Marque', 'Langue'] },
    { name: 'Historique_Actions', headers: ['Timestamp', 'Action', 'Statut', 'Message', 'Utilisateur_Email', 'Suggestion_Correction'] },
    { name: 'Prospects', headers: ['ID_Profil_Source', 'Date_Capture', 'Nom_Prospect', 'Contact_Prospect', 'Message_Note'] },
    { name: 'Statistiques', headers: ['ID_Profil', 'Date_Heure', 'Source'] },
    { name: 'Produits', headers: ['ID_Produit', 'ID_Utilisateur', 'Nom', 'Description', 'Prix', 'Images_JSON', 'Date_Creation', 'Actif'] },
    { name: 'Categories', headers: ['ID_Categorie', 'ID_Utilisateur', 'Nom_Categorie'] },
    { name: 'Documents', headers: ['ID_Document', 'ID_Utilisateur', 'Type', 'Nom', 'URL', 'Date_Ajout'] },
    { name: 'Support', headers: ['Date', 'Email', 'Sujet', 'Message', 'Statut', 'Telephone'] },
    { name: 'Configuration', headers: ['Clé', 'Valeur', 'Description'] },
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
      
      // Initialisation de la configuration
      if (sheetInfo.name === 'Configuration') {
        sheet.appendRow(['CALLMEBOT_PHONE', '+1234567890', 'Votre numéro (avec code pays) pour CallMeBot']);
        sheet.appendRow(['CALLMEBOT_API_KEY', '123456', 'Votre clé API CallMeBot']);
        sheet.appendRow(['EMAIL_SIGNATURE', '<p>Cordialement,<br><strong>L\'équipe Mahu</strong><br><a href="https://mahu.cards">mahu.cards</a></p>', 'Signature HTML des emails']);
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
    { name: 'Utilisateurs', headers: ['ID_Unique', 'Email', 'Mot_De_Passe', 'ID_Entreprise', 'Role', 'URL_Profil', 'ID_Cartes_NFC', 'Onboarding_Status', 'Auth_Token', 'Token_Expiration', 'Reset_Token', 'Reset_Token_Expiration'] },
    { name: 'Profils', headers: ['ID_Utilisateur', 'Email', 'Nom_Complet', 'Telephone', 'Profession', 'Compagnie', 'Location', 'URL_Photo', 'URL_Couverture', 'Liens_Sociaux_JSON', 'Lead_Capture_Actif', 'CV_Actif', 'CV_Data', 'WALLET_ISSUER_ID', 'WALLET_CLASS_ID', 'WALLET_SERVICE_EMAIL', 'WALLET_PRIVATE_KEY', 'Mise_En_Page', 'Couleur_Theme', 'Cacher_Marque', 'Langue'] },
    { name: 'Historique_Actions', headers: ['Timestamp', 'Action', 'Statut', 'Message', 'Utilisateur_Email', 'Suggestion_Correction'] },
    { name: 'Prospects', headers: ['ID_Profil_Source', 'Date_Capture', 'Nom_Prospect', 'Contact_Prospect', 'Message_Note'] },
    { name: 'Statistiques', headers: ['ID_Profil', 'Date_Heure', 'Source'] },
    { name: 'Produits', headers: ['ID_Produit', 'ID_Utilisateur', 'Nom', 'Description', 'Prix', 'Images_JSON', 'Date_Creation', 'Actif'] },
    { name: 'Categories', headers: ['ID_Categorie', 'ID_Utilisateur', 'Nom_Categorie'] },
    { name: 'Documents', headers: ['ID_Document', 'ID_Utilisateur', 'Type', 'Nom', 'URL', 'Date_Ajout'] },
    { name: 'Support', headers: ['Date', 'Email', 'Sujet', 'Message', 'Statut', 'Telephone'] },
    { name: 'Configuration', headers: ['Clé', 'Valeur', 'Description'] },
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
 * Gère l'inscription d'un nouvel utilisateur.
 * @param {string} email - L'email de l'utilisateur.
 * @param {string} password - Le mot de passe.
 * @param {string} [enterpriseId] - ID de l'entreprise si c'est un employé (optionnel).
 * @returns {Object} Un objet indiquant le succès ou l'échec.
 */
function registerUser(email, password, enterpriseId = '') {
  if (!email || !password) {
    throw new Error("L'email et le mot de passe sont requis.");
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Utilisateurs');
  const usersData = userSheet.getDataRange().getValues();
  const emailCol = usersData[0].indexOf('Email');

  const userExists = usersData.slice(1).some(row => row[emailCol] === email);
  if (userExists) {
    return { success: false, error: "Cet email est déjà utilisé." };
  }

  // Créer le nouvel utilisateur
  const newId = 'user_' + Utilities.getUuid();
  const profileUrl = email.split('@')[0].replace(/[^a-z0-9]/gi, '') + Math.floor(Math.random() * 1000);
  const token = Utilities.getUuid();
  const expiration = new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000); // Expire dans 7 jours

  // Sécurisation du mot de passe (Hash + Salt)
  const salt = Utilities.getUuid(); // Utilise un UUID comme sel unique
  const passwordHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password));
  const storedPassword = salt + "$" + passwordHash;

  const role = enterpriseId ? 'Employe' : 'Entreprise'; // Par défaut Entreprise si pas d'ID parent, sinon Employé
  
  const newUserRow = [newId, email, storedPassword, enterpriseId, role, profileUrl, '[]', 'ONBOARDING_STARTED', token, expiration, '', ''];
  userSheet.appendRow(newUserRow);

  // Créer un profil de base associé
  const profileSheet = ss.getSheetByName('Profils');
  profileSheet.appendRow([newId, email, email.split('@')[0], '', '', '', '', '', '', '[]', 'NON', 'NON', '']); // Ligne de profil initial, avec une colonne vide pour le téléphone

  // --- ENVOI EMAIL DE BIENVENUE ---
  try {
    const loginUrl = "https://mahu.cards/Connexion.html";
    const subject = "Bienvenue sur Mahu !";
    const htmlBody = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee; box-shadow: 0 5px 15px rgba(0,0,0,0.05);">
        <div style="background-color: #000000; padding: 30px 20px; text-align: center;">
          <img src="https://mahu.cards/r/logo.png" alt="Mahu Logo" style="height: 50px; vertical-align: middle;">
        </div>
        <div style="padding: 40px 30px; color: #1a1a1a; line-height: 1.8; font-size: 16px;">
          <h2 style="color: #000000; margin-top: 0; font-weight: 300; letter-spacing: 1px; text-transform: uppercase; font-size: 24px; text-align: center; margin-bottom: 30px;">Bienvenue chez Mahu</h2>
          <p>Bonjour,</p>
          <p>C'est un plaisir de vous accueillir. Votre compte Mahu a été créé avec succès, vous ouvrant les portes d'une nouvelle expérience de connexion.</p>
          <p>Configurez dès à présent votre carte de visite numérique et distinguez-vous.</p>
          <div style="text-align: center; margin: 40px 0;">
            <a href="${loginUrl}" style="background-color: #000000; color: #ffffff; padding: 16px 32px; text-decoration: none; font-weight: 500; font-size: 14px; display: inline-block; letter-spacing: 1px; text-transform: uppercase;">Accéder à mon espace</a>
          </div>
        </div>
        <div style="background-color: #fcfcfc; padding: 20px; text-align: center; font-size: 11px; color: #999999; border-top: 1px solid #eeeeee;">
          &copy; ${new Date().getFullYear()} Mahu. L'excellence de la connexion.
        </div>
      </div>`;

    sendEmail(email, subject, htmlBody);
  } catch (e) {
    Logger.log("Erreur envoi email bienvenue: " + e.message);
  }

  SpreadsheetApp.flush();
  logAction('registerUser', 'SUCCESS', `Nouvel utilisateur créé: ${email}`, email);
  
  return { success: true, newUser: true, token: token };
}

/**
 * Gère la connexion d'un utilisateur.
 * @param {string} email - L'email de l'utilisateur.
 * @param {string} password - Le mot de passe.
 * @returns {Object} Un objet indiquant le succès ou l'échec.
 */
function loginUser(email, password) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Utilisateurs');
  const usersData = userSheet.getDataRange().getValues();
  const headers = usersData[0];
  const emailCol = headers.indexOf('Email');
  const passwordCol = headers.indexOf('Mot_De_Passe');
  const tokenCol = headers.indexOf('Auth_Token');
  const expCol = headers.indexOf('Token_Expiration');
  const onboardingStatusCol = headers.indexOf('Onboarding_Status');

  // On cherche l'utilisateur à partir de la 2ème ligne (index 1)
  const userRowIndex = usersData.slice(1).findIndex(row => row[emailCol] === email);

  // Si l'utilisateur n'est pas trouvé
  if (userRowIndex === -1) {
    return { success: false, error: "Email ou mot de passe incorrect." };
  }

  const storedPassword = usersData[userRowIndex + 1][passwordCol];
  let isPasswordValid = false;

  // Vérification du mot de passe (supporte le nouveau format sécurisé et l'ancien format en clair)
  if (storedPassword.includes('$')) {
    const parts = storedPassword.split('$');
    const salt = parts[0];
    const hash = parts[1];
    const checkHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + password));
    if (checkHash === hash) isPasswordValid = true;
  } else {
    // Fallback pour les anciens comptes : si le mot de passe correspond en clair, on le valide et on le sécurise
    if (storedPassword === password) {
      isPasswordValid = true;
      // Auto-upgrade : on sécurise le mot de passe immédiatement
      const newSalt = Utilities.getUuid();
      const newHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, newSalt + password));
      userSheet.getRange(userRowIndex + 2, passwordCol + 1).setValue(newSalt + "$" + newHash);
    }
  }

  if (!isPasswordValid) {
    return { success: false, error: "Email ou mot de passe incorrect." };
  }

  // Générer et sauvegarder un nouveau token
  const token = Utilities.getUuid();
  const expiration = new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000); // 7 jours
  
  const sheetRow = userRowIndex + 2; // +1 pour compenser le slice, +1 car les index de feuille commencent à 1
  userSheet.getRange(sheetRow, tokenCol + 1).setValue(token);
  userSheet.getRange(sheetRow, expCol + 1).setValue(expiration);

  const onboardingStatus = usersData[userRowIndex + 1][onboardingStatusCol];

  return { success: true, newUser: onboardingStatus !== 'COMPLETED', token: token };
}
/**
 * Gère la demande de réinitialisation de mot de passe.
 * @param {string} email - L'email de l'utilisateur.
 * @returns {Object} Un objet indiquant le succès.
 */
function forgotPassword(email) {
  if (!email) throw new Error("L'email est requis.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Utilisateurs');
  const usersData = userSheet.getDataRange().getValues();
  const headers = usersData[0];
  const emailCol = headers.indexOf('Email');
  const resetTokenCol = headers.indexOf('Reset_Token');
  const resetExpCol = headers.indexOf('Reset_Token_Expiration');

  // Cherche l'utilisateur à partir de la 2ème ligne (index 1) pour ignorer les en-têtes
  const userRowIndex = usersData.slice(1).findIndex(row => row[emailCol] === email);

  // Ne pas renvoyer d'erreur si l'utilisateur n'existe pas pour des raisons de sécurité.
  if (userRowIndex === -1) {
    logAction('forgotPassword', 'INFO', `Tentative de reset pour un email inexistant: ${email}`, email);
    return { success: true, message: "Vérifiez votre boîte mail. Un lien vous a été envoyé, il expire dans 5 minutes." };
  }
  
  const resetToken = Utilities.getUuid();
  const expiration = new Date(new Date().getTime() + 5 * 60 * 1000); // Expire dans 5 minutes

  const sheetRow = userRowIndex + 2; // +1 pour compenser le slice, +1 car les index de feuille commencent à 1
  // Utiliser setValues pour une meilleure performance et pour éviter les erreurs de dimension.
  // On s'assure que les colonnes sont adjacentes pour que cela fonctionne.
  if (resetExpCol === resetTokenCol + 1) {
    userSheet.getRange(sheetRow, resetTokenCol + 1, 1, 2).setValues([[resetToken, expiration]]);
  } else {
    // Fallback si les colonnes ne sont pas côte à côte (moins performant)
    userSheet.getRange(sheetRow, resetTokenCol + 1).setValue(resetToken);
    userSheet.getRange(sheetRow, resetExpCol + 1).setValue(expiration);
  }

  const resetUrl = `https://mahu.cards/ResetPassword.html?token=${resetToken}`;
  const subject = "Réinitialisation de votre mot de passe Mahu";
  // Version texte simple pour les clients mail qui ne supportent pas le HTML
  const textBody = `Bonjour,\n\nVous avez demandé la réinitialisation de votre mot de passe. Cliquez sur le lien ci-dessous (valide 5 minutes) pour continuer:\n${resetUrl}\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.\n\nL'équipe Mahu`;

  // Version HTML pour un rendu plus professionnel
  const htmlBody = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee; box-shadow: 0 5px 15px rgba(0,0,0,0.05);">
      <div style="background-color: #000000; padding: 30px 20px; text-align: center;">
        <img src="https://mahu.cards/r/logo.png" alt="Mahu Logo" style="height: 50px; vertical-align: middle;">
      </div>
      <div style="padding: 40px 30px; color: #1a1a1a; line-height: 1.8; font-size: 16px;">
        <h2 style="color: #000000; margin-top: 0; font-weight: 300; letter-spacing: 1px; text-transform: uppercase; font-size: 24px; text-align: center; margin-bottom: 30px;">Réinitialisation</h2>
        <p>Bonjour,</p>
        <p>Nous avons reçu une demande de réinitialisation pour votre compte Mahu.</p>
        <p>Pour définir votre nouveau mot de passe, veuillez cliquer sur le bouton ci-dessous :</p>
        <div style="text-align: center; margin: 40px 0;">
          <a href="${resetUrl}" style="background-color: #000000; color: #ffffff; padding: 16px 32px; text-decoration: none; font-weight: 500; font-size: 14px; display: inline-block; letter-spacing: 1px; text-transform: uppercase;">Réinitialiser le mot de passe</a>
        </div>
        <p style="font-size: 13px; color: #666;">Ce lien est valide pendant <strong>5 minutes</strong>.</p>
        <p style="font-size: 13px; color: #666;">Si le bouton ne fonctionne pas, copiez ce lien :<br>
        <a href="${resetUrl}" style="color: #000000; text-decoration: underline;">${resetUrl}</a></p>
        <p style="font-size: 13px; color: #999; margin-top: 30px; font-style: italic;">Si vous n'avez pas demandé cette réinitialisation, ignorez cet e-mail.</p>
      </div>
      <div style="background-color: #fcfcfc; padding: 20px; text-align: center; font-size: 11px; color: #999999; border-top: 1px solid #eeeeee;">
        &copy; ${new Date().getFullYear()} Mahu. L'excellence de la connexion.
      </div>
    </div>`;

  sendEmail(email, subject, htmlBody, textBody);
  logAction('forgotPassword', 'SUCCESS', `Email de réinitialisation envoyé à ${email}`, email);

  return { success: true, message: "Vérifiez votre boîte mail. Un lien vous a été envoyé, il expire dans 5 minutes." };
}

/**
 * Réinitialise le mot de passe de l'utilisateur avec un token.
 * @param {string} token - Le token de réinitialisation.
 * @param {string} newPassword - Le nouveau mot de passe.
 * @returns {Object} Un objet indiquant le succès ou l'échec.
 */
function resetPassword(token, newPassword) {
  if (!token || !newPassword) throw new Error("Le token et le nouveau mot de passe sont requis.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Utilisateurs');
  const usersData = userSheet.getDataRange().getValues();
  const headers = usersData[0];
  const passwordCol = headers.indexOf('Mot_De_Passe');
  const resetTokenCol = headers.indexOf('Reset_Token');
  const resetExpCol = headers.indexOf('Reset_Token_Expiration');

  // Cherche le token à partir de la 2ème ligne (index 1) pour ignorer les en-têtes
  const userRowIndex = usersData.slice(1).findIndex(row => row[resetTokenCol] === token);

  // Si le token n'est trouvé dans aucune ligne, il est invalide.
  if (userRowIndex === -1) {
    logAction('resetPassword', 'ERROR', `Tentative de reset avec un token invalide: ${token}`, 'anonyme');
    return { success: false, error: "Token invalide ou déjà utilisé." };
  }
  const userDataRow = usersData[userRowIndex + 1]; // +1 pour obtenir la bonne ligne de données

  const expiration = new Date(userDataRow[resetExpCol]);
  if (expiration < new Date()) {
    logAction('resetPassword', 'ERROR', `Tentative de reset avec un token expiré: ${token}`, 'anonyme');
    return { success: false, error: "Le token a expiré." };
  }

  const sheetRow = userRowIndex + 2; // +1 pour compenser le slice, +1 car les index de feuille commencent à 1
  // Mettre à jour le mot de passe et effacer le token en une seule opération
  
  // Sécurisation du nouveau mot de passe
  const salt = Utilities.getUuid();
  const passwordHash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + newPassword));
  const storedPassword = salt + "$" + passwordHash;

  userSheet.getRange(sheetRow, passwordCol + 1).setValue(storedPassword); // Mise à jour du mot de passe
  userSheet.getRange(sheetRow, resetTokenCol + 1, 1, 2).setValues([['', '']]); // Efface le token et son expiration

  return { success: true };
}

/**
 * Trouve un utilisateur par son token d'authentification.
 * @param {string} token - Le token à rechercher.
 * @returns {Object|null} L'objet utilisateur ou null s'il n'est pas trouvé ou a expiré.
 */
function getUserByToken(token) {
  if (!token) return null;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Utilisateurs');
  const usersData = userSheet.getDataRange().getValues();
  const headers = usersData.shift();
  const tokenCol = headers.indexOf('Auth_Token');
  const expCol = headers.indexOf('Token_Expiration');

  const userRow = usersData.find(row => row[tokenCol] === token);
  if (!userRow || new Date(userRow[expCol]) < new Date()) {
    return null; // Token non trouvé ou expiré
  }
  return headers.reduce((obj, header, index) => { obj[header] = userRow[index]; return obj; }, {});
}

/**
 * Crée un compte employé depuis le tableau de bord administrateur.
 */
function createEmployee(data, adminUser) {
  if (adminUser.Role !== 'Entreprise') {
    throw new Error("Seuls les comptes Entreprise peuvent créer des employés.");
  }

  const email = data.email;
  const password = data.password;
  const name = data.name;

  // Utilise la fonction d'inscription existante en passant l'ID de l'admin comme entreprise
  const registerResult = registerUser(email, password, adminUser.ID_Unique);

  if (!registerResult.success) {
    return registerResult;
  }

  // Si succès, on met à jour le nom immédiatement
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Utilisateurs');
  const profileSheet = ss.getSheetByName('Profils');
  
  // Trouver le nouvel utilisateur (c'est le dernier ajouté)
  const lastRow = userSheet.getLastRow();
  const newUserId = userSheet.getRange(lastRow, 1).getValue(); // ID_Unique est col 1
  
  // Mettre à jour le nom dans la feuille Profils (dernière ligne aussi)
  profileSheet.getRange(profileSheet.getLastRow(), 3).setValue(name); // Nom_Complet est col 3

  return { success: true, message: "Employé créé avec succès." };
}

/**
 * Fonction centrale pour charger toutes les données du tableau de bord en un seul appel.
 * @returns {Object} Un objet contenant toutes les données nécessaires pour le dashboard.
 */
function getDashboardData(user) {
  if (!user) throw new Error("Utilisateur non authentifié pour getDashboardData.");
  try {
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

    // --- Récupérer les statistiques de vues (pour le graphique) ---
    const statsSheet = ss.getSheetByName('Statistiques');
    const allViews = statsSheet.getLastRow() > 1 
      ? statsSheet.getRange('A2:C' + statsSheet.getLastRow()).getValues()
      : [];
    const sevenDaysAgo = new Date(new Date().setDate(new Date().getDate() - 7));
    
    const userViews = allViews.filter(row => 
      row[0] === user.URL_Profil && // Filtre par URL de profil
      row[1] && new Date(row[1]) >= sevenDaysAgo // Filtre sur les 7 derniers jours
    );

    const viewCounts = { 'NFC': 0, 'QR Code': 0, 'Lien': 0 };
    userViews.forEach(view => {
      const source = view[2]; // La source est dans la 3ème colonne (index 2)
      if (viewCounts.hasOwnProperty(source)) {
        viewCounts[source]++;
      }
    });

    const stats = {
      labels: Object.keys(viewCounts),
      data: Object.values(viewCounts)
    };

    // --- Récupérer le nombre total de vues ---
    const totalUserViews = allViews.filter(row => row[0] === user.URL_Profil).length;

    // Récupérer les prospects
    const prospectsSheet = ss.getSheetByName('Prospects');
    const allProspects = prospectsSheet.getLastRow() > 1
      ? prospectsSheet.getRange('A2:E' + prospectsSheet.getLastRow()).getValues()
      : [];
    const userProspects = allProspects
      .filter(row => row[0] === user.ID_Unique) // Filtrer par ID_Profil_Source (colonne A)
      // Formater pour le frontend (les indices sont pour les colonnes 0=ID_Profil_Source, 1=Date_Capture, 2=Nom_Prospect, 3=Contact_Prospect, 4=Message_Note)
      .map(row => ({ id: row[0], date: row[1], nom: row[2], contact: row[3], note: row[4] })) 
      .slice(0, 10); // Limiter aux 10 derniers pour l'aperçu

    // --- Récupérer les produits de la boutique ---
    const productsSheet = ss.getSheetByName('Produits');
    const allProducts = productsSheet.getLastRow() > 1
      ? productsSheet.getRange('A2:H' + productsSheet.getLastRow()).getValues()
      : [];
    const productsHeaders = productsSheet.getRange(1, 1, 1, productsSheet.getLastColumn()).getValues()[0];
    const userProducts = allProducts
      .filter(row => row[1] === user.ID_Unique) // Filtrer par ID_Utilisateur (colonne B)
      .map(row => {
        const productObj = {};
        productsHeaders.forEach((header, index) => productObj[header] = row[index]);
        return productObj;
      });

    // --- Récupérer les documents (Coffre-fort) ---
    const docsSheet = ss.getSheetByName('Documents');
    const allDocs = docsSheet && docsSheet.getLastRow() > 1
      ? docsSheet.getRange('A2:F' + docsSheet.getLastRow()).getValues()
      : [];
    const userDocs = allDocs
      .filter(row => row[1] === user.ID_Unique)
      .map(row => ({
        id: row[0],
        type: row[2],
        name: row[3],
        url: row[4],
        date: row[5]
      }));

    const totalProspectsCount = allProspects.filter(row => row[0] === user.ID_Unique).length;

    // --- Données d'équipe (Si Entreprise) ---
    let teamData = [];
    if (user.Role === 'Entreprise') {
      const usersData = ss.getSheetByName('Utilisateurs').getDataRange().getValues();
      const uHeaders = usersData[0];
      const uIdCol = uHeaders.indexOf('ID_Unique');
      const uEntCol = uHeaders.indexOf('ID_Entreprise');
      const uEmailCol = uHeaders.indexOf('Email');
      const uUrlCol = uHeaders.indexOf('URL_Profil');

      // Trouver tous les employés liés à cette entreprise
      const employees = usersData.filter(row => row[uEntCol] === user.ID_Unique);
      
      teamData = employees.map(emp => {
        const empId = emp[uIdCol];
        // Trouver le nom dans les profils
        const pRow = profilesData.find(p => p[profileUserIdCol] === empId);
        const empName = pRow ? pRow[profilesHeaders.indexOf('Nom_Complet')] : 'Sans nom';
        // Compter les prospects de cet employé
        const empLeads = allProspects.filter(lead => lead[0] === empId).length;
        
        return {
          id: empId, name: empName, email: emp[uEmailCol], url: emp[uUrlCol], leads: empLeads
        };
      });
    }

    // Construire l'URL de base de l'application web
    const appUrl = "https://mahu.cards/ProfilePublic.html"; // URL générique

    return {
      user: user,
      profile: profile,
      prospects: userProspects,
      documents: userDocs, // Ajout des documents
      products: userProducts, // Ajout des produits
      appUrl: appUrl,
      stats: stats, // Nouvelles données pour le graphique
      totalViews: totalUserViews, // Nouvelle donnée
      totalProspects: totalProspectsCount,
      team: teamData, // Données de l'équipe
      onboardingStatus: user.Onboarding_Status // Ajout du statut d'onboarding
    };
  } catch (e) {
    Logger.log(`Erreur dans getDashboardData pour ${user.Email}: ${e.message} (Ligne: ${e.lineNumber})`);
    return { error: e.message };
  }
}

/**
 * Récupère uniquement l'URL du profil public de l'utilisateur connecté.
 * C'est une fonction légère pour les pages publiques.
 * @returns {Object} Un objet contenant l'URL du profil.
 */
function getPublicProfileUrl(user) {
  if (!user) throw new Error("Utilisateur non authentifié pour getPublicProfileUrl.");
  try {
    return { success: true, profileUrl: user.URL_Profil };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Récupère toutes les données d'un profil pour l'affichage public.
 * @param {string} profileUrl - L'URL unique du profil (ex: 'mon-nom').
 * @returns {Object} Un objet contenant toutes les données du profil à afficher.
 */
function getProfileData(profileUrl) {
  if (!profileUrl) return { error: "URL de profil manquante." };

  // --- OPTIMISATION RADICALE AVEC CACHE ---
  const cache = CacheService.getScriptCache();
  const cacheKey = `profile_${profileUrl}`;
  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    Logger.log(`Profil '${profileUrl}' servi depuis le cache.`);
    return JSON.parse(cachedData);
  }
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const usersSheet = ss.getSheetByName('Utilisateurs');
    const profilesSheet = ss.getSheetByName('Profils');

    // --- OPTIMISATION : Recherche ciblée avec TextFinder ---
    // Cette méthode évite de charger toute la base de données en mémoire.
    
    // 1. Récupérer les en-têtes (opération très rapide)
    const usersHeaders = usersSheet.getRange(1, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    const urlColIdx = usersHeaders.indexOf('URL_Profil') + 1; // +1 pour l'index 1-based
    
    if (urlColIdx === 0) return { error: "Colonne URL_Profil introuvable." };
    if (usersSheet.getLastRow() <= 1) return { error: "Aucun utilisateur enregistré." };

    // 2. Chercher l'URL dans la colonne spécifique (très rapide même sur de grandes feuilles)
    const userFinder = usersSheet.getRange(2, urlColIdx, usersSheet.getLastRow() - 1, 1)
      .createTextFinder(profileUrl)
      .matchEntireCell(true);
    const foundUser = userFinder.findNext();

    if (!foundUser) return { error: "Profil non trouvé." };

    // 3. Récupérer l'ID et l'Email de l'utilisateur trouvé
    const userRowIndex = foundUser.getRow();
    const userRowData = usersSheet.getRange(userRowIndex, 1, 1, usersSheet.getLastColumn()).getValues()[0];
    const userId = userRowData[usersHeaders.indexOf('ID_Unique')];
    const userEmail = userRowData[usersHeaders.indexOf('Email')];
    const enterpriseId = userRowData[usersHeaders.indexOf('ID_Entreprise')]; // Récupérer l'ID entreprise

    // 4. Chercher le profil correspondant dans la feuille Profils
    const profilesHeaders = profilesSheet.getRange(1, 1, 1, profilesSheet.getLastColumn()).getValues()[0];
    const pIdColIdx = profilesHeaders.indexOf('ID_Utilisateur') + 1;
    
    const profileFinder = profilesSheet.getRange(2, pIdColIdx, profilesSheet.getLastRow() - 1, 1)
      .createTextFinder(userId)
      .matchEntireCell(true);
    const foundProfile = profileFinder.findNext();

    if (!foundProfile) return { error: "Données de profil manquantes." };

    // 5. Lire les données du profil
    const profileRowIndex = foundProfile.getRow();
    const profileData = profilesSheet.getRange(profileRowIndex, 1, 1, profilesSheet.getLastColumn()).getValues()[0];

    const profileDataObject = profilesHeaders.reduce((obj, header, index) => {
      obj[header] = profileData[index];
      return obj;
    }, {});

    profileDataObject.Email = userEmail;

    // --- LOGIQUE D'HÉRITAGE ENTREPRISE ---
    // Si l'utilisateur a un ID_Entreprise (c'est un employé), on surcharge certaines données
    // avec celles de l'entreprise (Design, Liens, Couverture, etc.)
    if (enterpriseId) {
      const entProfileFinder = profilesSheet.getRange(2, pIdColIdx, profilesSheet.getLastRow() - 1, 1)
        .createTextFinder(enterpriseId)
        .matchEntireCell(true);
      const foundEntProfile = entProfileFinder.findNext();
      
      if (foundEntProfile) {
        const entRowIndex = foundEntProfile.getRow();
        const entData = profilesSheet.getRange(entRowIndex, 1, 1, profilesSheet.getLastColumn()).getValues()[0];
        
        // Champs à hériter de l'entreprise
        const inheritedFields = ['Compagnie', 'Location', 'URL_Couverture', 'Liens_Sociaux_JSON', 'Mise_En_Page', 'Couleur_Theme', 'Cacher_Marque'];
        
        inheritedFields.forEach(field => {
          const idx = profilesHeaders.indexOf(field);
          // On écrase la donnée de l'employé par celle de l'entreprise
          if (idx !== -1) profileDataObject[field] = entData[idx];
        });
      }
    }

    // Mise en cache (6 heures)
    cache.put(cacheKey, JSON.stringify(profileDataObject), 21600); // 21600 secondes = 6 heures

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
function saveProfile(data, user) {
  // Correction pour gérer les différents formats de données reçues.
  // Les données peuvent être un objet JSON stringifié dans 'payload' (formulaire principal)
  // ou des paires clé/valeur directes (sauvegarde d'image).
  let payload;
  // Si 'data' est un objet avec des clés, c'est probablement une sauvegarde d'image.
  // On vérifie que ce n'est pas un objet vide {} qui vient de JSON.parse(e.parameter.payload) quand payload est absent.
  if (typeof data === 'object' && data !== null && Object.keys(data).length > 0) {
    payload = data;
  } else {
    payload = (typeof data === 'string') ? JSON.parse(data) : {}; // Cas du formulaire principal
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const cache = CacheService.getScriptCache();
    const profileSheet = ss.getSheetByName('Profils');
    const userSheet = ss.getSheetByName('Utilisateurs');
    
    let currentProfileUrl = user.URL_Profil;

    // 1. Gérer la mise à jour de l'URL du profil (si elle a changé)
    if (payload.URL_Profil && payload.URL_Profil !== user.URL_Profil) {
      const newUrl = payload.URL_Profil.toLowerCase().replace(/[^a-z-0-9-]/g, ''); // Nettoyage
      if (!newUrl) throw new Error("L'URL du profil ne peut pas être vide.");

      const usersData = userSheet.getDataRange().getValues();
      const emailCol = usersData[0].indexOf('Email');
      const urlCol = usersData[0].indexOf('URL_Profil');

      // Vérifier l'unicité de la nouvelle URL (en excluant l'utilisateur actuel)
      const isTaken = usersData.some((row, i) => i > 0 && row[urlCol] === newUrl && row[emailCol] !== user.Email);
      if (isTaken) {
        return { success: false, error: "Cette URL de profil est déjà utilisée. Veuillez en choisir une autre." };
      }

      // Mettre à jour l'URL dans la feuille 'Utilisateurs'
      const userRowIndex = usersData.findIndex(row => row[emailCol] === user.Email);
      if (userRowIndex !== -1) {
        userSheet.getRange(userRowIndex + 1, urlCol + 1).setValue(newUrl);
        
        // Supprimer l'ancien cache car la clé change
        cache.remove(`profile_${currentProfileUrl}`);
        currentProfileUrl = newUrl;
      }
    }

    // 2. Mettre à jour les autres données dans la feuille 'Profils' et le Cache
    const profilesData = profileSheet.getDataRange().getValues();
    const headers = profilesData.shift();
    const userIdCol = headers.indexOf('ID_Utilisateur');
    const dataIndex = profilesData.findIndex(row => row[userIdCol] === user.ID_Unique);

    if (dataIndex !== -1) {
      const rowToUpdate = dataIndex + 2;
      const currentRow = profilesData[dataIndex];

      headers.forEach((header, index) => {
        // Mettre à jour uniquement si la clé existe dans les données envoyées et n'est pas l'URL (gérée avant)
        if (Object.prototype.hasOwnProperty.call(payload, header) && header !== 'URL_Profil') {
          profileSheet.getRange(rowToUpdate, index + 1).setValue(payload[header]);
          currentRow[index] = payload[header]; // Mise à jour en mémoire pour le cache
        }
      });
      
      // Reconstruire l'objet complet pour le cache
      const profileDataObject = headers.reduce((obj, header, index) => {
        obj[header] = currentRow[index];
        return obj;
      }, {});
      profileDataObject.Email = user.Email;

      // Mise à jour immédiate du cache (6 heures)
      cache.put(`profile_${currentProfileUrl}`, JSON.stringify(profileDataObject), 21600);

      return { success: true, message: "Profil sauvegardé avec succès." };
    }
    return { success: false, error: "Profil non trouvé pour la mise à jour." };
  } catch (e) {
    Logger.log(`Erreur dans saveProfile: ${e.message}`);
    return { error: e.message };
  }
}

/**
 * Met à jour UNIQUEMENT les images du profil (photo ou couverture).
 * C'est une fonction plus stricte et sécurisée que d'utiliser saveProfile pour les images.
 * @param {Object} data - Un objet contenant { imageType: 'picture'|'cover', imageUrl: '...' }.
 * @param {Object} user - L'objet utilisateur authentifié.
 */
function saveProfileImage(data, user) {
  if (!data || !data.imageType || !user) {
    throw new Error("Données d'image ou utilisateur invalides.");
  }

  const { imageType, imageUrl } = data;
  const fieldToUpdate = imageType === 'picture' ? 'URL_Photo' : 'URL_Couverture';

  if (imageType !== 'picture' && imageType !== 'cover') {
    return { success: false, error: "Type d'image non valide." };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const profileSheet = ss.getSheetByName('Profils');
    const profilesData = profileSheet.getDataRange().getValues();
    const headers = profilesData.shift();
    const userIdCol = headers.indexOf('ID_Utilisateur');
    
    const dataIndex = profilesData.findIndex(row => row[userIdCol] === user.ID_Unique);

    if (dataIndex === -1) {
      return { success: false, error: "Profil non trouvé pour la mise à jour de l'image." };
    }

    const rowToUpdate = dataIndex + 2;
    const colIndex = headers.indexOf(fieldToUpdate);
    
    // Mise à jour Sheet
    profileSheet.getRange(rowToUpdate, colIndex + 1).setValue(imageUrl);

    // Mise à jour Cache (Intelligent)
    const currentRow = profilesData[dataIndex];
    currentRow[colIndex] = imageUrl; // Mise à jour en mémoire

    const profileDataObject = headers.reduce((obj, header, index) => {
      obj[header] = currentRow[index];
      return obj;
    }, {});
    profileDataObject.Email = user.Email;

    CacheService.getScriptCache().put(`profile_${user.URL_Profil}`, JSON.stringify(profileDataObject), 21600);

    return { success: true, message: "Image sauvegardée avec succès." };
  } catch (e) {
    Logger.log(`Erreur dans saveProfileImage: ${e.message}`);
    return { success: false, error: e.message };
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
    const emailCol = usersData[0].indexOf('Email');

    const userRow = usersData.find(row => row[urlCol] === leadData.profileUrl);
    if (!userRow) throw new Error("Profil source introuvable.");

    const profileOwnerId = userRow[idCol];
    const profileOwnerEmail = userRow[emailCol];

    const prospectsSheet = ss.getSheetByName('Prospects');
    prospectsSheet.appendRow([profileOwnerId, new Date(), leadData.name, leadData.contact, leadData.message]);
    Logger.log(`Nouveau prospect capturé pour ${profileOwnerId}: ${leadData.name}`);

    // --- ENVOI EMAIL NOTIFICATION ---
    if (profileOwnerEmail) {
      try {
        // Lien vers la page de connexion avec l'email pré-rempli
        const connectionUrl = `https://mahu.cards/Connexion.html?email=${encodeURIComponent(profileOwnerEmail)}`;
        const subject = "Nouveau prospect sur votre carte Mahu !";
        const htmlBody = `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee; box-shadow: 0 5px 15px rgba(0,0,0,0.05);">
          <div style="background-color: #000000; padding: 30px 20px; text-align: center;">
            <img src="https://mahu.cards/r/logo.png" alt="Mahu Logo" style="height: 50px; vertical-align: middle;">
          </div>
          <div style="padding: 40px 30px; color: #1a1a1a; line-height: 1.8; font-size: 16px;">
            <h2 style="color: #000000; margin-top: 0; font-weight: 300; letter-spacing: 1px; text-transform: uppercase; font-size: 24px; text-align: center; margin-bottom: 30px;">Nouveau Contact</h2>
            <p>Bonjour,</p>
            <p>Une nouvelle opportunité se présente. Une personne a partagé ses coordonnées via votre profil Mahu.</p>
            <div style="background-color: #f9f9f9; padding: 25px; border-left: 4px solid #000000; margin: 30px 0;">
                <p style="margin: 5px 0; font-size: 15px;"><strong>NOM :</strong> <span style="font-weight: 300;">${leadData.name}</span></p>
                <p style="margin: 5px 0; font-size: 15px;"><strong>CONTACT :</strong> <span style="font-weight: 300;">${leadData.contact}</span></p>
                <p style="margin: 15px 0 5px 0; font-size: 15px;"><strong>MESSAGE :</strong></p>
                <p style="margin: 0; font-style: italic; color: #555;">"${leadData.message || 'Aucun message'}"</p>
            </div>
            <div style="text-align: center; margin: 40px 0;">
              <a href="${connectionUrl}" style="background-color: #000000; color: #ffffff; padding: 16px 32px; text-decoration: none; font-weight: 500; font-size: 14px; display: inline-block; letter-spacing: 1px; text-transform: uppercase;">Me connecter pour voir</a>
            </div>
          </div>
          <div style="background-color: #fcfcfc; padding: 20px; text-align: center; font-size: 11px; color: #999999; border-top: 1px solid #eeeeee;">
            &copy; ${new Date().getFullYear()} Mahu. L'excellence de la connexion.
          </div>
        </div>`;

        sendEmail(profileOwnerEmail, subject, htmlBody);
      } catch (e) {
        Logger.log("Erreur envoi email prospect: " + e.message);
      }
    }

    return { success: true };
  } catch (e) {
    Logger.log(`Erreur dans handleLeadCapture: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * Gère les messages de support.
 */
function handleSupportMessage(data, user) {
  const email = user ? user.Email : (data.email || 'anonyme');
  const phone = data.phone || '';
  const subject = data.subject || 'Demande de support';
  const message = data.message || '';

  if (!message) throw new Error("Le message ne peut pas être vide.");

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const supportSheet = ss.getSheetByName('Support');
  // Ajout à la fin (correspond aux headers définis plus haut)
  supportSheet.appendRow([new Date(), email, subject, message, 'NOUVEAU', phone]);

  // 1. Envoyer une confirmation par email à l'utilisateur
  const confirmationSubject = "Réception de votre demande de support";
  const confirmationBody = `
    <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eeeeee;">
      <div style="padding: 30px; color: #1a1a1a;">
        <h2 style="margin-top: 0;">Nous avons bien reçu votre message</h2>
        <p>Bonjour,</p>
        <p>Merci d'avoir contacté le support Mahu. Nous avons bien reçu votre demande concernant : "<strong>${subject}</strong>".</p>
        ${phone ? `<p>Nous avons noté votre numéro : ${phone}</p>` : ''}
        <p>Notre équipe va l'examiner et reviendra vers vous dans les plus brefs délais.</p>
        <p>Votre message :</p>
        <blockquote style="background: #f9f9f9; border-left: 4px solid #000; padding: 10px; margin: 10px 0;">${message}</blockquote>
      </div>
    </div>`;
  
  // On envoie l'email uniquement si on a une adresse valide
  if (email && email.includes('@')) {
    sendEmail(email, confirmationSubject, confirmationBody);
  }

  // 2. Envoyer une notification CallMeBot à l'admin
  const adminMessage = `🔔 *Support Mahu*\n\n👤 De: ${email}\n📞📞📞📞📞📞📞📞 Tel: ${phone}\n📝 Sujet: ${subject}\n💬 Message: ${message}`;
  sendCallMeBotMessage(adminMessage);

  return { success: true, message: "Message envoyé au support." };
}

/**
 * Envoie un message via CallMeBot (WhatsApp).
 */
function sendCallMeBotMessage(text) {
  let phone = getConfigValue('CALLMEBOT_PHONE');
  const apiKey = getConfigValue('CALLMEBOT_API_KEY');

  if (!phone || !apiKey || phone === '+1234567890') {
    Logger.log("CallMeBot non configuré.");
    return;
  }
  
  // Correction automatique : Ajoute le + si l'utilisateur a mis seulement le numéro (ex: 336...)
  phone = String(phone).trim();
  if (!phone.startsWith('+')) {
    phone = '+' + phone;
  }

  const encodedText = encodeURIComponent(text);
  const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedText}&apikey=${apiKey}`;

  try {
    UrlFetchApp.fetch(url);
    Logger.log("Notification CallMeBot envoyée.");
  } catch (e) {
    Logger.log("Erreur CallMeBot: " + e.message);
  }
}

/**
 * Récupère une valeur de configuration depuis la feuille 'Configuration'.
 */
function getConfigValue(key) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const configSheet = ss.getSheetByName('Configuration');
  if (!configSheet) return null;

  const data = configSheet.getDataRange().getValues();
  // On suppose que la clé est en colonne A (index 0) et la valeur en colonne B (index 1)
  // On saute la ligne d'en-tête
  const row = data.find(r => r[0] === key);
  return row ? row[1] : null;
}

/**
 * Fonction de test pour CallMeBot, exécutable depuis l'éditeur ou le menu.
 */
function testCallMeBot() {
  const phone = getConfigValue('CALLMEBOT_PHONE');
  const apiKey = getConfigValue('CALLMEBOT_API_KEY');

  if (!phone || !apiKey || phone === '+1234567890' || apiKey === '123456') {
    SpreadsheetApp.getUi().alert("Configuration CallMeBot incomplète", "Veuillez renseigner les valeurs réelles pour CALLMEBOT_PHONE et CALLMEBOT_API_KEY dans la feuille 'Configuration'.", SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const message = "✅ Ceci est un message de test depuis votre application Mahu. La configuration CallMeBot fonctionne !";
  sendCallMeBotMessage(message);
  SpreadsheetApp.getUi().alert("Test CallMeBot", "Un message de test a été envoyé à votre numéro. Veuillez vérifier WhatsApp.", SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * Fonction utilitaire pour envoyer des emails.
 */
function sendEmail(recipient, subject, htmlBody, textBody) {
  const mailOptions = {
    htmlBody: htmlBody,
    name: CONFIG.SENDER_NAME
  };

  // Ajout de la signature
  const signature = getConfigValue('EMAIL_SIGNATURE') || `<p>Cordialement,<br>L'équipe Mahu</p>`;
  
  // On s'assure que le corps HTML est bien fermé avant d'ajouter la signature, 
  // ou on l'ajoute simplement à la fin si c'est un fragment.
  // Pour faire simple, on l'ajoute à la fin du contenu HTML.
  mailOptions.htmlBody = htmlBody + signature;

  if (CONFIG.SENDER_EMAIL_ALIAS) {
    mailOptions.from = CONFIG.SENDER_EMAIL_ALIAS;
  }

  if (!textBody) {
    textBody = "Veuillez activer l'affichage HTML pour voir ce message.";
  }

  GmailApp.sendEmail(recipient, subject, textBody, mailOptions);
}

/**
 * Sauvegarde un document dans le coffre-fort.
 */
function saveDocument(payload, user) {
  if (!payload || !payload.url || !payload.type) throw new Error("Données de document invalides.");
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let docSheet = ss.getSheetByName('Documents');
  if (!docSheet) {
    // Création de secours si la feuille n'existe pas
    docSheet = ss.insertSheet('Documents');
    docSheet.appendRow(['ID_Document', 'ID_Utilisateur', 'Type', 'Nom', 'URL', 'Date_Ajout']);
  }
  
  // Si c'est une carte d'identité (recto ou verso), on supprime l'ancienne version pour cet utilisateur
  if (payload.type === 'card_front' || payload.type === 'card_back') {
     const data = docSheet.getDataRange().getValues();
     // On parcourt à l'envers pour supprimer sans casser les index
     for (let i = data.length - 1; i >= 1; i--) {
       if (data[i][1] === user.ID_Unique && data[i][2] === payload.type) {
         docSheet.deleteRow(i + 1);
       }
     }
  }

  const docId = 'doc_' + Utilities.getUuid();
  docSheet.appendRow([
    docId,
    user.ID_Unique,
    payload.type,
    payload.name || payload.type,
    payload.url,
    new Date()
  ]);
  
  return { success: true };
}

/**
 * Supprime un document du coffre-fort.
 */
function deleteDocument(docId, user) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const docSheet = ss.getSheetByName('Documents');
  const data = docSheet.getDataRange().getValues();
  
  // On cherche le document qui correspond à l'ID et à l'utilisateur (sécurité)
  const rowIndex = data.findIndex(row => row[0] === docId && row[1] === user.ID_Unique);
  
  if (rowIndex !== -1) {
    docSheet.deleteRow(rowIndex + 1); // +1 car les index de feuille commencent à 1
    return { success: true };
  }
  return { success: false, error: "Document non trouvé ou accès refusé." };
}

/**
 * Associe un nouvel ID de carte NFC à l'utilisateur connecté.
 * @param {string} nfcId - L'identifiant unique de la carte NFC.
 */
function linkNfcCard(nfcId, user) {
  // Implémentation basique : ajoute l'ID à la liste des cartes de l'utilisateur
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName('Utilisateurs');
  const usersData = userSheet.getDataRange().getValues();
  const headers = usersData[0];
  const idCol = headers.indexOf('ID_Unique');
  const nfcCol = headers.indexOf('ID_Cartes_NFC');

  const rowIndex = usersData.findIndex(row => row[idCol] === user.ID_Unique);
  if (rowIndex === -1) return { success: false, error: "Utilisateur introuvable." };

  let currentCards = [];
  try {
    currentCards = JSON.parse(usersData[rowIndex][nfcCol] || '[]');
  } catch (e) { currentCards = []; }

  if (!currentCards.includes(nfcId)) {
    currentCards.push(nfcId);
    userSheet.getRange(rowIndex + 1, nfcCol + 1).setValue(JSON.stringify(currentCards));
    return { success: true, message: "Carte NFC liée avec succès." };
  }
  
  return { success: true, message: "Cette carte est déjà liée." };
}

/**
 * Met à jour l'état d'un module (CV, Lead Capture) pour l'utilisateur connecté.
 * @param {string} moduleName - Le nom du module ('CV_Actif' ou 'Lead_Capture_Actif').
 * @param {boolean} isEnabled - L'état du module.
 * @param {Object} user - L'objet utilisateur authentifié.
 */
function setModuleState(moduleName, isEnabled, user) {
  try {
    const dataToSave = {};
    dataToSave[moduleName] = isEnabled ? 'OUI' : 'NON';
    saveProfile(dataToSave, user); // Réutilise la fonction saveProfile pour mettre à jour
    Logger.log(`Module ${moduleName} mis à jour à ${isEnabled} pour l'utilisateur.`);
  } catch(e) {
    Logger.log(`Erreur dans setModuleState: ${e.message}`);
  }
}

/**
 * Exporte les prospects de l'utilisateur connecté au format CSV.
 * @returns {string} Une chaîne de caractères contenant les données au format CSV.
 */
function exportLeadsAsCSV(user) {
  try { // La vérification du user est faite dans doPost
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
function updateOnboardingData(request, user) {
  if (!user) throw new Error("Utilisateur non authentifié pour updateOnboardingData.");
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName('Utilisateurs');
    const usersData = userSheet.getDataRange().getValues();
    const userHeaders = usersData.shift();
    const userIdCol = userHeaders.indexOf('ID_Unique');
    const userRowIndex = usersData.findIndex(row => row[userIdCol] === user.ID_Unique) + 2; // +2 pour obtenir la ligne de la feuille

    if (userRowIndex < 2) throw new Error("Utilisateur non trouvé pour la mise à jour.");

    if (request.step === 'final') {
      const statusCol = userHeaders.indexOf('Onboarding_Status') + 1;
      userSheet.getRange(userRowIndex, statusCol).setValue('COMPLETED');
      Logger.log(`Onboarding terminé pour ${user.Email}.`);
    } else if (request.data) {
      // Mise à jour du rôle dans la feuille Utilisateurs
      if (request.data.Role) {
        const roleCol = userHeaders.indexOf('Role') + 1;
        userSheet.getRange(userRowIndex, roleCol).setValue(request.data.Role);
        Logger.log(`Rôle mis à jour à '${request.data.Role}' pour ${user.Email}.`);
      }
      
      // Mise à jour des données dans la feuille Profils
      // Réutilise la logique de saveProfile mais de manière plus directe
      const saveResult = saveProfile(request.data, user);
      // Si la sauvegarde du profil a échoué, on propage l'erreur.
      if (!saveResult.success) {
        return saveResult; // Renvoie l'objet d'erreur de saveProfile
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
 * LOGIQUE POUR LA GESTION DE LA BOUTIQUE
 * ==================================================================
 */

/**
 * Gère la création, la mise à jour et la suppression de produits.
 * @param {string} action - 'saveProduct' ou 'deleteProduct'.
 * @param {Object} payload - Les données du produit.
 * @param {Object} user - L'utilisateur authentifié.
 */
function handleProductActions(action, payload, user) {
  const productsSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Produits');
  const headers = productsSheet.getRange(1, 1, 1, productsSheet.getLastColumn()).getValues()[0];
  const productIdCol = headers.indexOf('ID_Produit');
  const userIdCol = headers.indexOf('ID_Utilisateur');

  if (action === 'saveProduct') {
    const productData = payload;
    const productId = productData.ID_Produit || 'prod_' + Utilities.getUuid();
    
    const data = productsSheet.getDataRange().getValues();
    const rowIndex = data.findIndex(row => row[productIdCol] === productId && row[userIdCol] === user.ID_Unique);

    const newRowData = [
      productId,
      user.ID_Unique,
      productData.Nom,
      productData.Description,
      productData.Prix,
      JSON.stringify(productData.Images_JSON || []),
      new Date(),
      'OUI' // Actif par défaut
    ];

    if (rowIndex !== -1) {
      // Mise à jour d'un produit existant
      productsSheet.getRange(rowIndex + 1, 1, 1, newRowData.length).setValues([newRowData]);
      logAction('saveProduct', 'SUCCESS', `Produit ${productId} mis à jour.`, user.Email);
    } else {
      // Création d'un nouveau produit
      productsSheet.appendRow(newRowData);
      logAction('saveProduct', 'SUCCESS', `Nouveau produit ${productId} créé.`, user.Email);
    }
    return { success: true, message: 'Produit sauvegardé.' };

  } else if (action === 'deleteProduct') {
    const productId = payload.ID_Produit;
    const data = productsSheet.getDataRange().getValues();
    const rowIndex = data.findIndex(row => row[productIdCol] === productId && row[userIdCol] === user.ID_Unique);

    if (rowIndex !== -1) {
      productsSheet.deleteRow(rowIndex + 1);
      logAction('deleteProduct', 'SUCCESS', `Produit ${productId} supprimé.`, user.Email);
      return { success: true, message: 'Produit supprimé.' };
    }
    return { success: false, error: 'Produit non trouvé ou non autorisé.' };
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
function generateGoogleWalletPass(user) {
  try { // La vérification du user est faite dans doPost
    const profile = getDashboardData(user).profile; // Récupère les données du profil

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
      'cardTitle': { 'defaultValue': { 'language': 'fr-FR', 'value': profile.Nom_Complet || 'Carte Mahu' } },
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