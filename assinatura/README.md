# Assinatura

Aplicacao de assinatura para kiosk Subway.

The kiosk interface is designed at a fixed 1080×1920 CSS pixels and runs at
scale 1 on the kiosk display. Smaller browser windows show the whole screen
scaled down to fit, which is useful for previewing on a desktop.

The welcome, signature and thank-you screens use the sliced artwork in
`../fatiado`, compressed to WebP for delivery. Screen changes fade and slide
between states. The signature screen animates the supplied yellow hand
(`fatiado/maozinha.png`) writing a signature stroke, following the prototype.

Look at the [Nuxt documentation](https://nuxt.com/docs/getting-started/introduction) to learn more.

## Setup

Use a Node.js version supported by Nuxt: 22.22.3+, 24.15.0+, or 26+.

Both projects pin Node.js 22.22.3 in `.nvmrc`. In each project directory, run:

```bash
nvm install
nvm use
```

Make sure to install dependencies:

```bash
# npm
npm install

# pnpm
pnpm install

# yarn
yarn install

# bun
bun install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
# npm
npm run dev

# pnpm
pnpm dev

# yarn
yarn dev

# bun
bun run dev
```

The development server listens on the local network. On another device connected
to the same network, open `http://<computer-ip>:3000`. On macOS, find the computer
IP in System Settings > Wi-Fi > Details, or run `ipconfig getifaddr en0` in
Terminal. If the page does not load, allow incoming connections for Node.js in
the macOS firewall settings.

## Signature sessions and local persistence

The separate [counter app](../contador-assinaturas) runs on
`http://localhost:3001` and queries this server on `http://localhost:3000` through
its own backend. Run both apps on the same computer; no CORS setup is needed.

Opening the signature screen starts a countdown configured by
`NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS` (10 seconds by default), and a
separate start deadline configured by `NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS`
(5 seconds by default). If signing does not start before the latter expires,
the kiosk returns to the welcome screen. Once signing starts, the start deadline
is canceled and drawing does not restart the session countdown. At its expiry,
a session with a trace is submitted automatically; an empty session returns to
the welcome screen without increasing the count.
After a successful signature, the thank-you screen returns to the welcome
screen after five seconds. Errors remain visible and allow a retry.

Only completion identifiers are saved, never signature strokes or images.
SQLite stores one UUID per completed session to make retries idempotent, and the
total is computed from these rows. The database defaults to
`.data/signatures.sqlite`, outside build output and ignored by Git. Set
`SIGNATURE_DB_PATH` to choose another persistent file location.
Back up the database using SQLite backup tools, or stop the server before copying
the database and any accompanying `-wal`/`-shm` files.

`GET /api/signatures/count` returns `{ "total": 0 }`.
`POST /api/signatures` accepts only `{ "id": "<UUID v4>" }` and returns the count.
These endpoints are for a trusted kiosk network, not public deployment: clients
can submit new identifiers, so the count is not proof of a legally valid signature.
All devices accessing the same server share the count. Restarting the server or
rebuilding preserves it; deleting the database does not.

This feature requires a Node server with a writable, persistent filesystem.
Static hosting (`npm run generate`) cannot provide these endpoints. Built-in
`node:sqlite` requires Node 22+; its experimental warning on Node 22 is
silenced by `server/utils/signature-store.ts`.
Run `npm test`, `npm run typecheck` and `npm run build` to validate changes.

## Production

Build the application for production:

```bash
# npm
npm run build

# pnpm
pnpm build

# yarn
yarn build

# bun
bun run build
```

Locally preview production build:

```bash
# npm
npm run preview

# pnpm
pnpm preview

# yarn
yarn preview

# bun
bun run preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Instalacao dos dois sites em um computador novo

### 1. Copiar os projetos

Copie as pastas `assinatura` e [contador-assinaturas](../contador-assinaturas)
para o computador de destino, incluindo os arquivos ocultos, como `.nvmrc`.
Nao copie `node_modules`, `.nuxt` ou `.output`.

Gere os builds no computador de destino, principalmente ao mudar de macOS para
Windows, para instalar as dependencias adequadas ao sistema.

### 2. Instalar Node.js

Instale Node.js **22.22.3** diretamente ou via NVM.
No macOS/Linux, dentro de cada projeto:

```bash
nvm install
nvm use
```

No Windows, use NVM for Windows e informe a versao explicitamente:

```bash
nvm install 22.22.3
nvm use 22.22.3
```

### 3. Criar os builds

Execute dentro de cada projeto:

```bash
npm ci
npm run build
```

Nao use `npm run generate`: os dois sites precisam de um backend Node.

### 4. Executar

Em um terminal, dentro da pasta `assinatura`:

```bash
npm run preview -- --host 0.0.0.0 --port 3000
```

Em outro terminal, dentro da pasta `contador-assinaturas`:

```bash
npm run preview
```

Mantenha os dois terminais abertos. Use `Ctrl+C` para parar cada servidor.
Os comandos funcionam tambem no PowerShell do Windows.

- Assinatura: http://localhost:3000
- Contador: http://localhost:3001

Os dois servidores devem rodar no mesmo computador. O contador consulta a API
de assinatura pelo backend usando `localhost`, sem configurar IP ou CORS.
Em outro dispositivo da rede, abra `http://<ip-do-servidor>:3000` ou
`http://<ip-do-servidor>:3001`; `localhost` no navegador desse dispositivo nao
aponta para o servidor. Permita as portas 3000 e 3001 no firewall somente na rede
local confiavel, se necessario.

Para conferir a integracao, conclua uma assinatura e observe o contador aumentar
automaticamente. A API http://localhost:3000/api/signatures/count deve retornar
um JSON com o campo `total`. Reinicie o servidor de assinatura e confira que o
numero foi preservado.

### 5. Dados, atualizacoes e inicializacao automatica

A contagem fica em `.data/signatures.sqlite`, relativa ao diretorio de onde o
servidor de assinatura e iniciado. Execute sempre da mesma pasta do projeto.
O diretorio deve permitir escrita.

Para transferir uma contagem existente, pare o servidor de origem antes de copiar
a pasta `.data` completa para a pasta do projeto de assinatura no destino.
Isso inclui eventuais arquivos `-wal` e `-shm`. O contador nao tem banco proprio.
Sem essa transferencia, o banco novo comeca com zero.

Para atualizar, pare os servidores, faca backup de `.data`, copie o codigo novo
sem apagar ou substituir `.data`, execute `npm ci` e `npm run build` em cada
projeto e inicie os servidores novamente. Como alternativa, configure
`SIGNATURE_DB_PATH` com um caminho absoluto fora da pasta de instalacao para
manter o banco separado das atualizacoes.

Para operacao definitiva, use a configuracao PM2 abaixo em vez dos terminais
com `npm run preview`.

## Quiosque Windows (recomendado)

Para o totem Windows offline com duas telas, use o kit em
[`kiosk-windows/`](../kiosk-windows/README.md): pacote com Node portatil,
inicializacao automatica, navegador em tela cheia por tela e checklist do
equipamento. Ele substitui o PM2 no Windows.

Nas configuracoes PM2 abaixo os servidores escutam somente em `127.0.0.1`
(este computador). Para acessar de outro dispositivo da rede, defina
`HOST=0.0.0.0` antes de `npm run pm2:start`.

## Operacao com PM2

Os dois projetos possuem `ecosystem.config.cjs` e comandos npm para PM2.
O PM2 executa o build diretamente, sem servidor de desenvolvimento, e reinicia
o processo em caso de falha. Cada configuracao fixa o diretorio de trabalho,
a porta e uma unica instancia. O caminho padrao do SQLite e absoluto, dentro
da pasta `.data` deste projeto, evitando mudar de banco conforme o terminal.

### Instalar e iniciar

Selecione Node.js 22.22.3 e instale o PM2 globalmente uma vez nesse computador:

```bash
nvm use 22.22.3
npm install --global pm2
```

Dentro de cada projeto:

```bash
npm ci
npm run build
npm run pm2:start
```

Pare antes qualquer servidor dev/preview que esteja usando as portas 3000/3001.
Os sites ficam em http://localhost:3000 e http://localhost:3001.
Depois de iniciar ambos, confira os endpoints de contagem e execute:

```bash
pm2 status
pm2 save
```

Os processos continuam rodando ao fechar os terminais. `pm2 save` salva a lista
de processos desse usuario, mas sozinho nao configura inicio ao ligar o PC.
Use sempre o mesmo usuario e a mesma instalacao de Node/PM2 para operar os sites.

### Inicializacao automatica

No Linux/macOS, execute `pm2 startup`, siga o comando administrativo exibido
pelo PM2 e execute `pm2 save` novamente. Confira a restauracao apos reiniciar.
Se trocar a versao/caminho do Node com NVM, atualize o daemon com `pm2 update`,
reaplique as configuracoes e regenere a integracao de startup para o novo Node.

No Windows, `pm2 startup` nao fornece a integracao nativa. Configure o Agendador
de Tarefas para executar `pm2 resurrect` usando o mesmo usuario, `PM2_HOME` e
Node.js 22.22.3. Use os caminhos absolutos de Node e do CLI PM2 na tarefa, pois
o PATH do NVM pode nao estar disponivel. Configure o disparo no login ou na
inicializacao conforme a conta usada e teste a restauracao apos reiniciar.
A configuracao do sistema operacional precisa ser feita no computador destino;
nao foi instalada automaticamente por este projeto.

### Logs, parada e atualizacoes

Dentro do projeto:

```bash
npm run pm2:logs
npm run pm2:stop
```

`Ctrl+C` sai da visualizacao dos logs sem parar o site.
Para atualizar, pare os dois processos, faca backup e preserve `.data`,
copie o codigo novo e execute em cada projeto:

```bash
npm ci
npm run build
npm run pm2:start
```

O mesmo comando inicia ou reinicia o processo existente, aplicando o ambiente.
Depois de conferir os sites, execute `pm2 save`. Para remover apenas este site
da lista: `pm2 delete assinatura`, seguido de `pm2 save`.
Nao use `pm2 delete all`, pois pode afetar outras aplicacoes.

As variaveis `SIGNATURE_DB_PATH`, `NUXT_SIGNATURE_API_BASE`,
`NUXT_PUBLIC_SIGNATURE_COUNTDOWN_SECONDS` e
`NUXT_PUBLIC_SIGNATURE_IDLE_TIMEOUT_SECONDS` podem ser definidas no ambiente
antes de `pm2:start` ou ajustadas nas respectivas configuracoes. Os dois
countdowns devem ser numeros inteiros positivos de segundos; os padroes sao
`10` e `5`, respectivamente.
O PM2 nao carrega automaticamente o arquivo `.env` da aplicacao.
Os logs ficam no diretorio do PM2; configure rotacao/retencao no computador
de destino para nao ocupar o disco indefinidamente.
