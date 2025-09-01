import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Alert, Image } from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';

// --- Variáveis de Ambiente ---
// As variáveis agora são lidas do arquivo .env
const GITHUB_TOKEN = process.env.EXPO_PUBLIC_GITHUB_TOKEN;
const REPO_OWNER = process.env.EXPO_PUBLIC_REPO_OWNER;
const REPO_NAME = process.env.EXPO_PUBLIC_REPO_NAME;
// -----------------------------

const INSTALLED_VERSION_KEY = 'zenith_installed_version';

export default function App() {
  const [status, setStatus] = useState('Iniciando...');
  const [storedVersion, setStoredVersion] = useState(null);
  const [latestVersion, setLatestVersion] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    // Verificação para garantir que as variáveis do .env foram carregadas
    if (!GITHUB_TOKEN || !REPO_OWNER || !REPO_NAME) {
      Alert.alert(
        "Erro de Configuração",
        "As variáveis de ambiente do GitHub (token, owner, repo) não foram encontradas. Verifique seu arquivo .env e reinicie o aplicativo."
      );
      setStatus("Erro de configuração. Verifique o arquivo .env.");
      setIsChecking(false);
      return;
    }
    checkUpdates();
  }, []);

  const checkUpdates = async () => {
    setIsChecking(true);
    setStatus('Verificando atualizações...');
    setDownloadProgress(0);

    try {
      const localVersion = await SecureStore.getItemAsync(INSTALLED_VERSION_KEY);
      setStoredVersion(localVersion || 'Nenhuma');
      const apiUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
      
      console.log("Buscando em:", apiUrl); // Log para depuração

      const response = await fetch(apiUrl, {
        headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Erro no GitHub: ${response.status} - ${errorBody}`);
      }
      
      const release = await response.json();
      const latestTag = release.tag_name;
      setLatestVersion(latestTag);
      const apkAsset = release.assets.find(asset => asset.name.endsWith('.apk'));

      if (!apkAsset) {
        setStatus('Erro: Nenhum arquivo .apk encontrado na release mais recente.');
        return;
      }
      
      setDownloadUrl(apkAsset.browser_download_url);

      if (localVersion === latestTag) {
        setStatus('Você já tem a versão mais recente registrada.');
      } else {
        setStatus(`Nova versão (${latestTag}) disponível!`);
      }
    } catch (error) {
      console.error('Falha ao verificar atualizações:', error);
      setStatus(`Falha ao verificar: ${error.message}`);
    } finally {
      setIsChecking(false);
    }
  };

  const downloadAndInstall = async () => {
    if (!downloadUrl) {
      Alert.alert('Erro', 'URL para download não encontrada.');
      return;
    }

    setIsDownloading(true);
    setStatus('Baixando...');
    const fileUri = FileSystem.documentDirectory + 'zenith_app.apk';

    const downloadResumable = FileSystem.createDownloadResumable(
      downloadUrl,
      fileUri,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/octet-stream' } },
      (progress) => {
        const percentage = Math.round((progress.totalBytesWritten / progress.totalBytesExpectedToWrite) * 100);
        setDownloadProgress(percentage);
      }
    );

    try {
      const { uri } = await downloadResumable.downloadAsync();
      setStatus('Download concluído. Abrindo instalador...');
      await SecureStore.setItemAsync(INSTALLED_VERSION_KEY, latestVersion);
      const contentUri = await FileSystem.getContentUriAsync(uri);

      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, 
        type: 'application/vnd.android.package-archive',
      });
      
      checkUpdates();

    } catch (error) {
      console.error('Erro no download/instalação:', error);
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
            <View style={styles.progressBarBackground}>
                <View style={[styles.progressBarFill, {width: `${downloadProgress}%`}]} />
            </View>
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

      <TouchableOpacity 
        style={styles.secondaryButton} 
        onPress={checkUpdates} 
        disabled={isChecking || isDownloading}
        activeOpacity={0.7}
      >
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