import React, { useState, useEffect, useRef } from 'react'; // Adicionado 'useRef'
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Alert, Image, Platform } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';

// --- Nome da nossa tarefa em segundo plano ---
const BACKGROUND_FETCH_TASK = 'background-update-check';

// --- Variáveis de Ambiente ---
const GITHUB_TOKEN = process.env.EXPO_PUBLIC_GITHUB_TOKEN;
const REPO_OWNER = process.env.EXPO_PUBLIC_REPO_OWNER;
const REPO_NAME = process.env.EXPO_PUBLIC_REPO_NAME;
// -----------------------------

const INSTALLED_VERSION_KEY = 'zenith_installed_version';

// ==============================================================================
// PARTE 1: LÓGICA DA TAREFA EM SEGUNDO PLANO
// (OBS: Esta parte pode ser removida se o GitHub Actions for a única fonte de notificações)
// ==============================================================================

TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
  try {
    console.log(`[${new Date().toLocaleTimeString()}] Executando tarefa em segundo plano...`);
    
    if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
      console.error("BG Task: Variáveis de ambiente não encontradas.");
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    const response = await fetch(apiUrl, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    });

    if (!response.ok) {
      console.error("BG Task: Falha ao buscar no GitHub.");
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    const release = await response.json();
    const latestTag = release.tag_name;
    const localVersion = await SecureStore.getItemAsync(INSTALLED_VERSION_KEY);

    if (latestTag && localVersion !== latestTag) {
      console.log(`[${new Date().toLocaleTimeString()}] Nova versão encontrada em background: ${latestTag}`);
      // A notificação agora virá do Firebase, então a linha abaixo pode ser removida.
      // await sendUpdateNotification(latestTag); 
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } else {
      console.log(`[${new Date().toLocaleTimeString()}] Nenhuma nova versão encontrada em background.`);
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
  } catch (error) {
    console.error("BG Task: Erro ao executar tarefa.", error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ==============================================================================
// PARTE 2: COMPONENTE DA INTERFACE DO USUÁRIO
// ==============================================================================

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function registerBackgroundFetchAsync() {
  console.log("Registrando tarefa de background...");
  return BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
    minimumInterval: 15 * 60, // Mínimo de 15 minutos
    stopOnTerminate: false,
    startOnBoot: true,
  });
}

async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permissão negada', 'Você não receberá notificações sobre novas atualizações!');
  }
}

export default function App() {
  const [status, setStatus] = useState('Iniciando...');
  const [storedVersion, setStoredVersion] = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // --- CÓDIGO ADICIONADO ---
  const notificationListener = useRef();
  const responseListener = useRef();
  // --- FIM DO CÓDIGO ADICIONADO ---

  useEffect(() => {
    registerForPushNotificationsAsync();
    registerBackgroundFetchAsync();

    // --- CÓDIGO ADICIONADO PARA RECEBER NOTIFICAÇÕES PUSH ---
    // Este listener é acionado quando o app está aberto e recebe uma notificação
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log('--- NOTIFICAÇÃO PUSH RECEBIDA ---');
      console.log(notification);
      // Ao receber a notificação, podemos re-verificar as atualizações
      checkUpdates();
    });

    // Este listener é acionado quando o usuário clica em uma notificação
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log('--- USUÁRIO CLICOU NA NOTIFICAÇÃO PUSH ---');
      console.log(response);
      // Ao clicar na notificação, também podemos re-verificar as atualizações
      checkUpdates();
    });
    // --- FIM DO CÓDIGO ADICIONADO ---

    if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
      Alert.alert("Erro de Configuração", "As variáveis de ambiente do GitHub não foram encontradas.");
      setStatus("Erro de configuração. Verifique o arquivo .env.");
      return;
    }
    checkUpdates();

    // --- CÓDIGO ADICIONADO (LIMPEZA DOS LISTENERS) ---
    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
    // --- FIM DO CÓDIGO ADICIONADO ---
  }, []);

  const checkUpdates = async () => {
    if (isChecking) return;
    setIsChecking(true);
    setStatus('Verificando atualizações...');
    try {
      const localVersion = await SecureStore.getItemAsync(INSTALLED_VERSION_KEY);
      setStoredVersion(localVersion || 'Nenhuma');
      const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
      const response = await fetch(apiUrl, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
      });
      if (!response.ok) throw new Error(`Erro no GitHub: ${response.status}`);
      const release = await response.json();
      const latestTag = release.tag_name;
      setLatestVersion(latestTag);
      const apkAsset = release.assets.find(asset => asset.name.endsWith('.apk'));
      if (!apkAsset) { setStatus('Erro: Nenhum .apk encontrado.'); return; }
      setDownloadUrl(apkAsset.browser_download_url);
      if (localVersion === latestTag) {
        setStatus('Você já tem a versão mais recente registrada.');
      } else {
        setStatus(`Nova versão (${latestTag}) disponível!`);
      }
    } catch (error) {
      setStatus(`Falha ao verificar: ${error.message}`);
    } finally {
      setIsChecking(false);
    }
  };

  const downloadAndInstall = async () => {
    if (!downloadUrl) { Alert.alert('Erro', 'URL para download não encontrada.'); return; }
    setIsDownloading(true);
    setStatus('Baixando...');
    const fileUri = FileSystem.documentDirectory + 'zenith_app.apk';
    const downloadResumable = FileSystem.createDownloadResumable(
      downloadUrl, fileUri,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/octet-stream' } },
      (progress) => setDownloadProgress(Math.round((progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100))
    );
    try {
      const { uri } = await downloadResumable.downloadAsync();
      setStatus('Download concluído. Abrindo instalador...');
      await SecureStore.setItemAsync(INSTALLED_VERSION_KEY, latestVersion);
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, type: 'application/vnd.android.package-archive',
      });
      checkUpdates();
    } catch (error) {
      setStatus('Erro ao abrir o instalador do app.');
      Alert.alert("Erro", "Não foi possível abrir o arquivo de instalação.");
    } finally {
      setIsDownloading(false);
      setDownloadProgress(0);
    }
  };
  
  const isUpdateAvailable = storedVersion !== latestVersion && latestVersion !== null;
  const showReinstallButton = !isUpdateAvailable && latestVersion !== null && !isChecking && !isDownloading;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.logoContainer}>
        <Image source={require('./assets/icons/icon512x512.png')} style={styles.appIcon} resizeMode="contain" />
        <Image source={require('./assets/icons/name.png')} style={styles.appNameImage} resizeMode="contain" />
      </View>
      <Text style={styles.headerTitle}>Instalador</Text>
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Versão Registrada:</Text>
          <Text style={styles.infoValue}>{storedVersion}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Última Versão:</Text>
          <Text style={styles.infoValue}>{latestVersion || 'Verificando...'}</Text>
        </View>
      </View>
      <Text style={styles.statusText}>{status}</Text>
      {isChecking && <ActivityIndicator size="large" color="#007AFF" style={styles.activityIndicator} />}
      {isDownloading && (
        <View style={styles.progressContainer}>
            <Text style={styles.progressText}>{`Baixando... ${downloadProgress}%`}</Text>
            <View style={styles.progressBarBackground}><View style={[styles.progressBarFill, {width: `${downloadProgress}%`}]} /></View>
        </View>
      )}
      {isUpdateAvailable && !isChecking && !isDownloading && (
        <TouchableOpacity style={styles.primaryButton} onPress={downloadAndInstall} activeOpacity={0.7}>
          <Text style={styles.primaryButtonText}>{storedVersion === 'Nenhuma' ? 'Instalar' : 'Atualizar'}</Text>
        </TouchableOpacity>
      )}
      {showReinstallButton && (
        <TouchableOpacity style={styles.primaryButton} onPress={downloadAndInstall} activeOpacity={0.7}>
          <Text style={styles.primaryButtonText}>Reinstalar ({latestVersion})</Text>
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.secondaryButton} onPress={checkUpdates} disabled={isChecking || isDownloading} activeOpacity={0.7}>
          <Text style={styles.secondaryButtonText}>Verificar Novamente</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F9FC', alignItems: 'center', padding: 25 },
  logoContainer: { marginTop: 60, marginBottom: 20, alignItems: 'center' },
  appIcon: { width: 100, height: 100, marginBottom: 10 },
  appNameImage: { width: 180, height: 50 },
  headerTitle: { fontSize: 24, fontWeight: '600', color: '#333333', marginBottom: 30 },
  infoCard: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 15, padding: 20, marginBottom: 25, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 5 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  infoLabel: { fontSize: 16, color: '#555555', fontWeight: '500' },
  infoValue: { fontSize: 16, color: '#333333', fontWeight: 'bold' },
  statusText: { fontSize: 17, color: '#666666', textAlign: 'center', minHeight: 40, marginVertical: 15 },
  activityIndicator: { marginVertical: 20 },
  primaryButton: { backgroundColor: '#007AFF', paddingVertical: 16, paddingHorizontal: 50, borderRadius: 30, width: '90%', alignItems: 'center', marginBottom: 15, shadowColor: '#007AFF', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 8 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },
  secondaryButton: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#007AFF', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 30, width: '90%', alignItems: 'center', marginBottom: 15 },
  secondaryButtonText: { color: '#007AFF', fontSize: 17, fontWeight: '600' },
  progressContainer: { width: '90%', alignItems: 'center', marginVertical: 20 },
  progressText: { fontSize: 16, color: '#555555', marginBottom: 10, fontWeight: '500' },
  progressBarBackground: { height: 12, width: '100%', backgroundColor: '#E0E7FF', borderRadius: 6, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: '#007AFF', borderRadius: 6 }
});