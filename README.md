# Sonora — player de músicas do YouTube com status no Discord

## Rodar
1. `npm install`
2. Discord: crie um app em https://discord.com/developers/applications (o nome do app aparece como "Ouvindo <nome>"),
   copie o **Application ID**, copie `.env.example` para `.env` e preencha `DISCORD_CLIENT_ID=...`.
   Deixe o Discord desktop aberto.
3. `npm run dev` → abra http://localhost:5173

Produção: `npm run build` e depois `npm start` → http://localhost:3001

Biblioteca e playlists ficam salvas no navegador (localStorage).

## App Android (APK) — funciona sem o PC
O arquivo pronto fica em `Sonora.apk`. Para instalar: copie para o celular (cabo, Google Drive, WhatsApp),
abra o arquivo e permita "instalar apps desta fonte" quando o Android pedir.

- Toca com a tela apagada e em segundo plano, usando dados móveis.
- Controles na notificação, na tela de bloqueio, em fones (Bluetooth ou com fio) e em relógios/pulseiras
  (Galaxy Fit/Watch) — todos usam a sessão de mídia do Android.
- Pausa sozinho se o fone desconectar ou chegar uma ligação.
- Ajustes → Reprodução e dados móveis: qualidade Econômica/Normal/Alta.
- Menu "⋯" de uma música, ou o botão de download numa playlist: baixa para ouvir sem internet
  (Biblioteca → Baixadas).
- Na versão APK não há status do Discord nem as pastas de música do PC.

Gerar o APK de novo depois de mudar o código:
```
npm run build
npx cap sync android
cd android && gradlew.bat assembleDebug
```
(o APK sai em `android/app/build/outputs/apk/debug/app-debug.apk`)

**Dica para Samsung:** em Configurações → Bateria → Limites de uso em segundo plano, coloque o Sonora em
"Apps nunca suspensos". Assim o sistema não fecha a música durante corridas longas.

## No celular pelo navegador (precisa do PC ligado)
1. No PC, rode `npm start`. O terminal mostra uma linha `No celular (mesmo Wi-Fi): http://192.168.x.x:3001`.
   Na primeira vez o Windows pode pedir permissão no Firewall: permita em **Redes privadas**.
2. No celular, conectado ao **mesmo Wi-Fi**, abra esse endereço no Chrome.
3. Menu ⋮ do Chrome → **Adicionar à tela inicial** para ter o ícone do Sonora.

O PC precisa estar ligado com o Sonora rodando: busca, letras, músicas locais e Discord vêm dele.
Curtidas, playlists e aparência ficam salvas em cada aparelho separadamente.

### Abrir como app instalado (tela cheia, sem barra do navegador)
O Chrome só "instala" sites em HTTPS. Para liberar o endereço do seu PC:
abra `chrome://flags/#unsafely-treat-insecure-origin-as-secure` no celular, cole `http://192.168.x.x:3001`,
ative, reinicie o Chrome e use **Instalar app** no menu ⋮.

### Limitações
- Vídeos do YouTube param quando a tela do celular apaga ou você troca de app (regra do YouTube para players embutidos).
  As músicas **locais** continuam tocando em segundo plano, com controles na tela de bloqueio.
- Qualquer aparelho no seu Wi-Fi consegue abrir o Sonora. Use só em rede de casa.
