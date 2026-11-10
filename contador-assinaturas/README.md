# Contador de assinaturas

Aplicacao Nuxt que exibe apenas a quantidade de assinaturas do projeto
[assinatura](../assinatura). Nao acessa o SQLite nem recebe desenhos.

## Desenvolvimento local

Use Node.js 22.22.3+, 24.15.0+ ou 26+.

Os dois projetos fixam Node.js 22.22.3 no arquivo `.nvmrc`.
Execute `nvm install` na primeira vez para instalar a versao indicada;
nas proximas vezes, basta `nvm use` dentro de cada projeto.

No projeto de assinatura:

```bash
cd ../assinatura
nvm install
nvm use
npm install
npm run dev
```

Em outro terminal, neste projeto:

```bash
nvm install
nvm use
npm install
npm run dev
```

- Assinatura: http://localhost:3000
- Contador: http://localhost:3001

O navegador consulta o backend do contador, que consulta
`http://localhost:3000/api/signatures/count`. Assim nao precisa de CORS nem de um
IP fixo, desde que os dois servidores rodem no mesmo computador. Mesmo um
navegador em outro dispositivo pode acessar o contador pelo IP desse computador:
o `localhost` utilizado na integracao continua sendo o do backend.

`NUXT_SIGNATURE_API_BASE` permite alterar o endereco do servidor de assinatura.
A configuracao e privada, usada apenas no backend; nao coloque esse valor em
`runtimeConfig.public`.

O contador atualiza a cada 2 segundos depois de cada resposta, sem consultas
sobrepostas. Em falhas, mostra um aviso e tenta novamente; se ja recebeu uma
contagem, identifica esse numero como desatualizado. Nunca transforma erros em zero.

## Producao local

```bash
npm run build
npm run preview
```

Para executar diretamente o build no macOS/Linux:

```bash
PORT=3001 HOST=0.0.0.0 node .output/server/index.mjs
```

O servidor de assinatura deve permanecer ativo na porta 3000. O contador requer
um servidor Node, nao hospedagem estatica. Os endpoints sao para uma rede local
confiavel; nao exponha as aplicacoes publicamente sem controles de acesso.

## Instalacao em um computador novo

### 1. Preparar os dois projetos

Copie este projeto e o projeto [assinatura](../assinatura), incluindo arquivos
ocultos como `.nvmrc`, mas sem `node_modules`, `.nuxt` ou `.output`.
Recomendamos criar os builds no computador de destino, especialmente ao mudar
de macOS para Windows.

Instale Node.js **22.22.3** diretamente ou via NVM. No macOS/Linux, use
`nvm install` e `nvm use` dentro de cada projeto. No Windows, use NVM for Windows:

```bash
nvm install 22.22.3
nvm use 22.22.3
```

### 2. Instalar dependencias e criar os builds

Dentro de cada projeto:

```bash
npm ci
npm run build
```

Nao use `npm run generate`, pois a consulta entre os sites depende dos backends.

### 3. Iniciar os sites

Em um terminal, dentro do projeto de assinatura:

```bash
npm run preview -- --host 0.0.0.0 --port 3000
```

Em outro terminal, dentro deste projeto:

```bash
npm run preview
```

Esses comandos funcionam tambem no PowerShell. Mantenha os terminais abertos;
use `Ctrl+C` para parar cada servidor.

- Assinatura: http://localhost:3000
- Contador: http://localhost:3001

Nao precisa configurar IP ou CORS quando os dois servidores estao no mesmo
computador: o contador consulta a assinatura pelo backend usando `localhost`.
Para acessar a tela de outro dispositivo, use `http://<ip-do-servidor>:3001`
e permita a porta no firewall da rede local confiavel, se necessario.

Conclua uma assinatura para verificar o aumento automatico da contagem.
Se o servidor de assinatura ficar indisponivel, o contador mostrara um aviso e
tentara reconectar sozinho.

### 4. Preservar os dados e atualizar

Este projeto nao armazena a contagem: ela fica em `.data/signatures.sqlite`
no projeto de assinatura. Para transferir os dados existentes, pare o servidor
de origem e copie a pasta `.data` completa, incluindo eventuais arquivos
`-wal`/`-shm`, para o projeto de assinatura no computador novo.
Sem essa transferencia, a contagem comeca em zero.

Ao atualizar, pare os dois servidores, faca backup de `.data` e preserve essa
pasta ao copiar o codigo novo. Execute `npm ci` e `npm run build` em ambos e
reinicie. Inicie sempre o servidor de assinatura a partir da mesma pasta,
ou configure `SIGNATURE_DB_PATH` com um caminho absoluto persistente.

Para uso definitivo no totem, use PM2 conforme a secao abaixo.

## Quiosque Windows (recomendado)

Para o totem Windows offline com duas telas, use o kit em
[`kiosk-windows/`](../kiosk-windows/README.md): pacote com Node portatil,
inicializacao automatica, navegador em tela cheia por tela e checklist do
equipamento. Ele substitui o PM2 no Windows.

Nas configuracoes PM2 abaixo os servidores escutam somente em `127.0.0.1`
(este computador). Para acessar de outro dispositivo da rede, defina
`HOST=0.0.0.0` antes de `npm run pm2:start`.

## Operacao com PM2

Este projeto possui `ecosystem.config.cjs`, com porta 3001, diretorio de trabalho
fixo, uma instancia e reinicio automatico. O backend consulta a assinatura em
`http://localhost:3000`. O outro projeto possui sua propria configuracao na
porta 3000, com banco SQLite persistente.

Selecione Node.js 22.22.3 e instale o PM2 globalmente uma vez:

```bash
nvm use 22.22.3
npm install --global pm2
```

Pare servidores dev/preview nas portas 3000/3001. Em cada projeto, execute:

```bash
npm ci
npm run build
npm run pm2:start
```

Confira http://localhost:3000 e http://localhost:3001 e depois execute:

```bash
pm2 status
pm2 save
```

Os sites continuam rodando sem terminais abertos. O comando `pm2:start` inicia
ou reinicia somente o processo do respectivo projeto, aplicando o ambiente.
Use sempre o mesmo usuario e a mesma instalacao de Node/PM2.

Para logs e parada deste contador:

```bash
npm run pm2:logs
npm run pm2:stop
```

`Ctrl+C` sai dos logs sem parar o site. Para atualizar, pare ambos os processos,
preserve e faca backup do banco `.data` da assinatura, copie o codigo novo e
execute `npm ci`, `npm run build` e `npm run pm2:start` em cada projeto.
Confira a integracao e execute `pm2 save`.
Para remover somente o contador: `pm2 delete contador-assinaturas` e `pm2 save`.

`pm2 save` sozinho nao configura inicio ao ligar o computador. No Linux/macOS,
use `pm2 startup`, siga o comando administrativo exibido e salve a lista.
No Windows, configure o Agendador de Tarefas para executar `pm2 resurrect`
com caminhos absolutos de Node/PM2, mesmo usuario e `PM2_HOME`.
Essa integracao deve ser configurada e testada no computador de destino.
Veja [as instrucoes completas de startup, NVM e dados](../assinatura/README.md#operacao-com-pm2).

Para mudar o servidor de assinatura, defina `NUXT_SIGNATURE_API_BASE` antes de
`pm2:start` ou ajuste `ecosystem.config.cjs`. O PM2 nao carrega `.env`
automaticamente. Configure rotacao/retencao dos logs no computador destino.

## Validacao

```bash
npm run typecheck
npm run build
npm test
```

Os testes da API iniciam um build ja gerado em porta temporaria e um servidor de
assinatura simulado. Nao alteram o banco real.
