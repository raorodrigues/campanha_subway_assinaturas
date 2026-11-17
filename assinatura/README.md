# Assinatura

Aplicação Nuxt da campanha Subway com duas telas servidas pelo mesmo servidor:

| Rota | Tela | Tamanho |
|---|---|---|
| `/` | Totem de assinatura (touch, vertical) | 1080×1920 |
| `/counter` | Contador para o painel LED | 384×192 |

## Totem MUB+ (`/`)

A interface é desenhada em 1080×1920 px CSS e roda em escala 1 no totem.
Janelas menores mostram a tela inteira reduzida, útil para pré-visualizar no
computador.

Todos os textos são texto real na fonte oficial (títulos e botão em Subway
Sans Cond Black, instrução de assinatura em Cond Medium), com tamanhos medidos
na arte original. Os títulos de boas-vindas e de agradecimento entram palavra
por palavra (`app/components/WordReveal.vue`) e saem de uma vez; a coreografia
fica em `app/assets/css/motion.css`. Fotos, fundo, rodapé e a mão amarela
(`fatiado/maozinha.png`) continuam sendo a arte fatiada em `../fatiado`,
comprimida em WebP.

## Contador do painel LED (`/counter`)

O software do painel LED captura um bloco de pixels **físicos** de uma área de
trabalho maior e estica-o sobre o painel inteiro. A página é desenhada em
384×192 e esticada para preencher exatamente esse bloco (padrão 384×192 no canto
superior esquerdo), compensando a escala do Windows e o zoom do navegador
(`devicePixelRatio`). O resto da janela fica preto. O número tem sempre pelo
menos 5 dígitos (42 → 00042). A página reproduz
`layouts/painel-led-contador-384x192px.mp4`: fundo de ondas em movimento, número
com animação de odômetro e "JÁ ASSINARAM" em Subway Sans Cond Black.

- `/counter?demo` simula novas assinaturas para conferir o painel.
- `/counter?calibrar` mostra uma régua em pixels físicos (faixas numeradas de
  32 em 32 px no topo e à esquerda) e uma moldura vermelha na área configurada.
  O último número visível em cada borda do painel é o tamanho capturado.
- `/counter?w=512&h=192` define o tamanho da área capturada e `?x=10&y=20` a
  origem, em pixels físicos (no kiosk: `counterWidth`/`counterHeight` e
  `counterOffsetX`/`counterOffsetY`).
- Um ponto de 4 px no canto inferior direito indica o estado da conexão:
  branco ao conectar, vermelho quando o servidor não responde.
- A contagem é atualizada a cada 500 ms depois de cada resposta, sem
  consultas sobrepostas. Em falhas, mantém o último número recebido; nunca
  transforma erros em zero.

## Fonte oficial Subway

Todos os textos usam a fonte oficial (Subway Sans Cond), com publicação
liberada pelo cliente. Só os 3 arquivos que o app usa (Medium, Bold e Black)
ficam no repositório, em `app/assets/fonts/subway/`; o pacote completo
`subway.zip` continua fora do Git e não é necessário para o build.

O build (`npm run build` / `npm run dev`) para com uma mensagem clara se algum
desses arquivos sumir, em vez de publicar outra fonte no totem. A lista de
arquivos usados fica em `scripts/subway-fonts.mjs`.

## Setup

Use Node.js 22.22.3+, 24.15.0+ ou 26+. O projeto fixa Node.js 22.22.3 em
`.nvmrc`:

```bash
nvm install
nvm use
npm install
npm run dev
```

O servidor de desenvolvimento escuta na rede local em `http://localhost:3000`.
Em outro aparelho da mesma rede, abra `http://<ip-do-computador>:3000`
(no macOS: `ipconfig getifaddr en0`). Se a página não carregar, permita conexões
de entrada para o Node.js no firewall do macOS.

## Testar localmente (`npm run local`)

Gera o build e sobe o servidor como no totem, em `http://127.0.0.1:3000`.
Funciona igual no Windows (Prompt de Comando ou PowerShell), macOS e Linux, sem
Git Bash, PowerShell script ou PM2. Se o terminal estiver num Node mais antigo,
usa sozinho um Node 22 instalado pelo nvm / nvm-windows.

**Contagem online:** coloque o token JWT num arquivo `token.txt` na **raiz do
repositório** (ao lado das pastas `assinatura/` e `kiosk-windows/`; o arquivo
nunca vai para o git). O URL e o intervalo vêm de `kiosk-windows/kiosk.json`. Ao
subir, o terminal mostra se a contagem está ligada e até quando o token vale (ou
avisa se está vazio ou expirado). Trocar o `token.txt` não exige reiniciar.

```bash
npm install                        # só na primeira vez
npm run local                      # build + servidor, API ligada se houver token.txt
npm run local -- --offline         # sem chamadas à API, só o SQLite local
npm run local -- --no-build        # reaproveita o build atual (.output)
npm run local -- --open            # abre o totem e o contador no navegador
npm run local -- --port=3001       # outra porta (padrão 3000)
```

**Onde ficam as assinaturas:** na pasta `dados/` da **raiz do repositório** (ao
lado de `assinatura/` e do `token.txt`, fora do git), que nenhum build, `git pull`
ou `npm ci` toca:

- `dados/signatures.sqlite`: o banco que o servidor usa;
- `dados/assinaturas.csv`: uma linha por assinatura (`id;criado_em_utc;criado_em_local`,
  separado por `;` para abrir direto no Excel em pt-BR).

Os dois se completam: ao subir, o servidor junta o que falta em cada um. Se o
banco sumir, ele é recriado a partir do CSV; se o CSV sumir, é regravado a partir
do banco. Abra o CSV no Excel só para ler ou copie-o antes; se o Excel salvar por
cima, as datas mudam de formato. Com o arquivo aberto no Excel, o Windows bloqueia
a escrita: a assinatura entra no banco e vai para o CSV no próximo início. Na
primeira vez, se ainda houver um banco antigo em `assinatura/.data/`, ele é
copiado para `dados/` (o original fica onde está, como backup).

Ctrl+C para parar. As linhas `[remote-count]` no terminal mostram cada mudança
da contagem online (`online count received: N` = OK; `HTTP 401` = token inválido
ou expirado; `no connection` = sem internet, o painel mantém o último número).

## Sessões de assinatura e persistência

Abrir a tela de assinatura mostra uma contagem regressiva para começar,
configurada por `NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS` (5 s por padrão). Se
ninguém tocar antes do fim, o totem volta às boas-vindas sem aumentar a contagem.
A assinatura termina quando o dedo fica fora da tela por
`NUXT_PUBLIC_SIGNATURE_FINISH_PAUSE_SECONDS` (3 s por padrão). Tirar o dedo e
voltar antes disso continua a mesma assinatura. Um limite,
`NUXT_PUBLIC_SIGNATURE_MAX_SECONDS` (30 s por padrão, a partir do primeiro toque),
salva a assinatura para que ninguém prenda o totem rabiscando sem parar; a partir
do primeiro toque, a contagem na tela mostra o tempo que falta até esse limite. Depois de uma assinatura, o
agradecimento volta às boas-vindas após 5 s. Erros ficam visíveis e permitem
tentar de novo.

Só identificadores de sessão são salvos, nunca traços ou imagens da assinatura.
O SQLite guarda um UUID por sessão concluída (o que torna os reenvios
idempotentes) e o horário de registro em `created_at` (UTC, ISO 8601). O total é
calculado a partir dessas linhas. O banco fica em `.data/signatures.sqlite`, fora
do build e ignorado pelo Git; defina `SIGNATURE_DB_PATH` para outro caminho
(`npm run local` usa `../dados/`, veja acima). Ao lado do banco fica
`assinaturas.csv`, uma cópia em texto de cada assinatura que o servidor usa para
reconstruir o banco, se ele se perder (`SIGNATURE_CSV_PATH` muda o caminho).
Para backup, use as ferramentas de backup do SQLite ou pare o servidor antes de
copiar o banco e os arquivos `-wal`/`-shm`.

O total retornado é `assinaturas no banco + NUXT_SIGNATURE_COUNT_OFFSET`
(padrão `0`), para somar assinaturas coletadas fora do totem. O offset nunca é
gravado no banco: mudar ou zerar o valor só muda o número exibido. Precisa ser
um inteiro ≥ 0; com valor inválido o servidor não sobe e mostra o motivo no log.

- `GET /api/signatures/count` retorna `{ "total": 0 }`.
- `POST /api/signatures` aceita apenas `{ "id": "<UUID v4>" }` e retorna a contagem.

Os endpoints são para uma rede local confiável, não para publicação: qualquer
cliente pode enviar identificadores novos, então a contagem não é prova de
assinatura com validade jurídica.

Requer um servidor Node com sistema de arquivos gravável e persistente;
hospedagem estática (`npm run generate`) não fornece os endpoints. O
`node:sqlite` nativo exige Node 22+; o aviso experimental do Node 22 é silenciado
em `server/utils/signature-store.ts`.

Para validar mudanças: `npm test` (depois de `npm run build`),
`npm run typecheck` e `npm run build`.

## Produção

```bash
npm ci
npm run build
npm run preview -- --host 0.0.0.0 --port 3000
```

- Assinatura: http://localhost:3000
- Contador: http://localhost:3000/counter

Para conferir a integração, conclua uma assinatura e veja o contador aumentar em
menos de 1 s. Reinicie o servidor e confira que o número foi preservado.

A contagem fica em `.data/signatures.sqlite`, relativa à pasta de onde o servidor
é iniciado. Para transferir uma contagem, pare o servidor de origem e copie a
pasta `.data` inteira (incluindo `-wal`/`-shm`). Para atualizar, pare o servidor,
faça backup de `.data`, copie o código novo sem substituir `.data`, rode
`npm ci` e `npm run build` e inicie de novo.

## Quiosque Windows (recomendado)

Para o totem Windows offline com duas telas, use o kit em
[`kiosk-windows/`](../kiosk-windows/README.md): pacote com Node portátil,
inicialização automática, navegador em tela cheia por tela e checklist do
equipamento. Ele substitui o PM2 no Windows.

## Operação com PM2

`ecosystem.config.cjs` executa o build diretamente, reinicia em caso de falha e
fixa diretório, porta e uma única instância. O caminho padrão do SQLite é
absoluto, dentro de `.data` deste projeto. O servidor escuta só em `127.0.0.1`;
defina `HOST=0.0.0.0` antes de `npm run pm2:start` para acesso pela rede.

```bash
nvm use 22.22.3
npm install --global pm2   # uma vez por computador
npm ci
npm run build
npm run pm2:start
pm2 status
pm2 save
```

- Logs: `npm run pm2:logs` (`Ctrl+C` sai sem parar o site).
- Parar: `npm run pm2:stop`. Remover só este site: `pm2 delete assinatura` e
  `pm2 save`. Não use `pm2 delete all`.
- Início automático: no Linux/macOS, `pm2 startup` e `pm2 save`. No Windows,
  configure o Agendador de Tarefas para `pm2 resurrect` com o mesmo usuário,
  `PM2_HOME` e Node 22.22.3 (caminhos absolutos).

`SIGNATURE_DB_PATH`, `NUXT_SIGNATURE_COUNT_OFFSET`,
`NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS`, `NUXT_PUBLIC_SIGNATURE_FINISH_PAUSE_SECONDS`
e `NUXT_PUBLIC_SIGNATURE_MAX_SECONDS` podem ser definidas no ambiente antes de
`pm2:start`. Os tempos são inteiros positivos em segundos (padrões `5`, `2` e
`30`). O PM2 não carrega o `.env` da aplicação. Configure rotação dos logs do
PM2 no computador de destino.
