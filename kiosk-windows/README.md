# Quiosque Windows offline (2 telas)

Kit para rodar **assinatura** (tela touch vertical) e **contador** (segunda tela)
em um único PC Windows 10/11 **sem internet**. Substitui o PM2 no Windows.

| Arquivo | Para que serve |
|---|---|
| `package-kiosk.sh` | Roda no Mac/Linux **com internet**. Extrai a fonte oficial de `subway.zip`, faz o build do site, roda os testes e monta a pasta `dist/kiosk` com o Node 22 portátil para Windows. |
| `install-kiosk.ps1` | Roda **uma vez** no totem, como Administrador. Inicialização automática, energia, gestos, notificações e políticas do navegador. |
| `start-kiosk.ps1` / `.cmd` | Sobe o servidor e abre um navegador em tela cheia por tela (assinatura em `/`, contador em `/counter`). Reabre o que fechar ou travar. |
| `stop-kiosk.cmd` | Encerra servidores e navegadores (manutenção). |
| `boot.html` | Tela verde "Iniciando…" que espera o servidor responder antes de abrir o site. |
| `kiosk.json` | Portas, tempos de assinatura, navegador e telas. |

## 1. Gerar o pacote (no Mac, com internet)

Antes, coloque `subway.zip` (fonte oficial, fora do git) na raiz do projeto.

```bash
cd kiosk-windows
./package-kiosk.sh            # ou SKIP_INSTALL=1 ./package-kiosk.sh para reaproveitar node_modules
```

Resultado: `kiosk-windows/dist/kiosk-AAAAMMDD-HHMM.zip`. O build é feito no Mac;
não há módulos nativos, então a mesma pasta `.output` roda no Windows.

## 2. Instalar no totem (offline)

1. Copie o zip por pendrive e extraia em **`C:\kiosk`** (a pasta deve conter `node\`,
   `assinatura\`, `start-kiosk.ps1`…).
   **Não** use Área de Trabalho, Documentos ou OneDrive: sincronização e antivírus
   podem travar o banco SQLite.
2. Abra o PowerShell **como Administrador** e rode:
   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\kiosk\install-kiosk.ps1 -User NOME_DO_USUARIO
   ```
   `-User` é a conta que entra automaticamente no totem (padrão: usuário atual).
3. Faça o **checklist do equipamento** (seção 3).
4. Reinicie o PC. Ao entrar com o usuário, as duas telas abrem sozinhas.

**Contagem existente:** para levar assinaturas já feitas, copie `signatures.sqlite`
(e `-wal`/`-shm`, se existirem), com o servidor de origem **parado**, para
`C:\kiosk\data\`.

## 3. Checklist do equipamento (manual, no hardware final)

Faça com a conta do totem logada. Marque cada item.

- [ ] **Escala 100%** nas duas telas: Configurações > Sistema > Tela > Escala.
      (O navegador também força escala 1, mas 100% evita surpresas.)
- [ ] **Tela touch em retrato** (1080×1920): Configurações > Sistema > Tela > Orientação.
- [ ] **Touch ligado à tela certa**: Painel de Controle > Configurações do Tablet PC >
      **Configurar** > Entrada por toque, e toque na tela do totem quando pedir.
      Teste depois de reiniciar: tocar no totem deve agir no totem, não na outra tela.
- [ ] **Login automático** da conta do totem (sem senha na inicialização).
- [ ] **Gestos de 3/4 dedos desligados**: Configurações > Bluetooth e dispositivos > Toque.
- [ ] **Windows ativado** (sem marca d'água) e **atualizações pausadas** durante a campanha.
- [ ] **Data e hora** corretas (sem internet não há sincronização automática).
- [ ] Windows **Home**: o bloqueio de gestos de borda pode não valer; teste deslizar
      das bordas. Se abrir menus, prefira Windows Pro.

## 4. Teste de aceitação (antes do evento)

1. Reinicie o PC. Em até ~30 s: totem mostra "Eleja frango…", contador mostra o número.
2. Toque em **Assine aqui**, assine com o dedo, aguarde o "Obrigado". O contador sobe em menos de 1 s.
3. Toque em **Assine aqui** e não assine: em 5 s volta ao início, sem contar.
4. Tente: pinça com dois dedos, toque longo em imagem, deslizar das bordas. Nada deve acontecer.
5. Feche um navegador com Alt+F4 (teclado USB): ele reabre em até 5 s.
6. Reinicie o PC: o número do contador continua o mesmo.

## 5. Operação

- **Parar para manutenção:** Ctrl+Alt+Del > Gerenciador de Tarefas > Executar nova tarefa >
  `C:\kiosk\stop-kiosk.cmd`. Para voltar: `C:\kiosk\start-kiosk.cmd` ou reinicie.
- **Logs:** `C:\kiosk\logs\kiosk.log` (inícios, reinícios, telas detectadas),
  `assinatura.log` (servidor único da assinatura e do contador).
- **Backup da contagem:** pare o quiosque e copie `C:\kiosk\data\` inteira.
- **Atualizar:** pare o quiosque, faça backup de `data\`, substitua tudo em `C:\kiosk`
  **exceto `data\`** pelo pacote novo e reinicie.

## 6. Configuração (`kiosk.json`)

| Campo | Padrão | Observação |
|---|---|---|
| `host` | `127.0.0.1` | Só este PC acessa os sites (sem aviso de firewall). Use `0.0.0.0` apenas se outro aparelho precisar acessar. |
| `signaturePort` | `3000` | Porta do servidor. O contador abre em `/counter` nesta mesma porta; `counterPort` de versões anteriores é ignorado. |
| `signatureCountdownSeconds` | `10` | Tempo total da sessão de assinatura. |
| `signatureIdleTimeoutSeconds` | `5` | Volta ao início se ninguém começar a assinar. |
| `signatureCountOffset` | `0` | Somado ao número do contador (ex.: assinaturas coletadas fora do totem). Não altera o banco. Inteiro ≥ 0; valor inválido impede o servidor de subir (veja `logs\assinatura.log`). |
| `browser` | `auto` | `auto` (Chrome se instalado, senão Edge), `edge` ou `chrome`. |
| `signatureScreen` / `counterScreen` | `auto` | `auto` usa a tela em retrato para a assinatura e a outra para o contador. Para fixar, use o número da tela mostrado em `kiosk.log` (ex.: `0`, `1`). |
| `forceDeviceScaleFactor` | `1` | Mantém o layout 1080×1920 em escala 1 mesmo com Windows em 125/150%. |

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Fica em "Iniciando…" | Servidor não sobe | Veja `logs\assinatura.log`. Confira se `node\node.exe` existe. |
| Sites abertos na tela trocada | Detecção automática | Fixe `signatureScreen`/`counterScreen` em `kiosk.json` pelos números do `kiosk.log`. |
| Toque age na tela errada | Mapeamento do touch | Checklist: Configurações do Tablet PC > Configurar. |
| Layout menor com bordas verdes | Escala/resolução da tela | Escala 100% e resolução 1080×1920 em retrato. |
| Contador mostra "Conexão interrompida" | Assinatura parada | Veja `logs\assinatura.log`; o kiosk reinicia o servidor sozinho. |
