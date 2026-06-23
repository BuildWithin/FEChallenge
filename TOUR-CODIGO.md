# Tour guiado pelo código — ATS Analytics Copilot

> Um passeio pela aplicação, **na ordem em que uma pergunta atravessa o sistema**.
> Cada parada tem um link clicável para o arquivo/linha exata, a **lógica** que
> implementamos ali e o **porquê** (tradeoffs e decisões). Use junto com o
> [DEMO.md](DEMO.md) (roteiro de apresentação) e o [DECISIONS.md](DECISIONS.md) (log de
> decisões). Para o desenho fatiado por specs, veja [specs/](specs/README.md).
>
> Leitura sugerida: siga as paradas em ordem (1 → 8). As paradas **3 e 4 são o
> coração** — se tiver pouco tempo, comece por elas.

---

## Mapa mental (as duas camadas)

```
Pergunta do usuário
   │
   ▼
1. UI / chat ............ src/app/page.tsx
   │  envia headers x-workspace + x-role
   ▼
2. Borda do servidor .... src/app/api/chat/route.ts → src/server/context.ts
   │  monta o ctx { workspaceId, role }
   ▼
5. Loop do agente ....... src/agent/run.ts  (+ provider.ts: modelo + system prompt)
   │  o modelo escolhe uma TOOL
   ▼
4. Catálogo de tools .... src/agent/tools.ts   (camada fina, declarativa)
   │  importa SÓ analytics.ts — nunca `db`, nunca SQL cru
   ▼
3. Catálogo de queries .. src/db/analytics.ts  ← OS DOIS CHOKEPOINTS
   │  scopeWhere + candidateSelection (tenant + PII por construção)
   ▼
6. UI generativa ........ src/app/tool-artifact.tsx  (rows + display → gráfico/tabela)

7. Provas ............... src/db/analytics.test.ts (unit) + evals/copilot.eval.ts (adversarial)
8. Tradeoffs ............ DECISIONS.md
```

A regra que organiza tudo: **todo acesso a dados é restrito ao workspace E ao papel do
chamador.** Um vazamento entre workspaces ou de PII é o pior bug possível aqui — por isso
ele é tornado *impossível por construção*, não evitado por disciplina.

---

## Parada 1 — Onde a pergunta entra (a UI)

📄 [src/app/page.tsx](src/app/page.tsx)

- [page.tsx:33-44](src/app/page.tsx#L33-L44) — o `transport` injeta os headers
  **`x-workspace`** e **`x-role`** em toda requisição, vindos dos seletores do topo.
  É assim que a identidade (mockada) viaja até o servidor.
- [page.tsx:46-49](src/app/page.tsx#L46-L49) — o `useChat` é **chaveado em
  `${activeWorkspace}:${role}`**. Decisão deliberada: trocar de workspace ou papel
  **reinicia a conversa** — evita misturar contexto de tenants/papéis diferentes na mesma
  thread (e dá takes limpos no demo).
- [page.tsx:204-219](src/app/page.tsx#L204-L219) — o painel lateral "Pipeline (this
  workspace)" é uma **leitura tRPC já escopada**; serve de prova ambiente de que o escopo
  segue o workspace ativo.
- [page.tsx:233](src/app/page.tsx#L233) — o componente `ToolCall` decide o estado visual
  (`calling…` / `result` / `error`) de cada chamada de tool conforme ela faz streaming.

---

## Parada 2 — A borda do servidor (montando o `ctx`)

📄 [src/app/api/chat/route.ts](src/app/api/chat/route.ts) · 📄 [src/server/context.ts](src/server/context.ts)

- [route.ts:8-13](src/app/api/chat/route.ts#L8-L13) — o endpoint extrai
  `{ workspaceId, role }` dos headers e passa adiante para `streamCopilot`. Nada de dado
  cru entra no agente sem passar por aqui.
- [context.ts:22-30](src/server/context.ts#L22-L30) — `tenantFromHeaders` é a **única
  fonte da verdade** para derivar tenant + papel de uma requisição.
- [context.ts:26-28](src/server/context.ts#L26-L28) — **tradeoff explícito:** o default é
  `admin` por conveniência de demo. O comentário registra que um sistema de produção faria
  o oposto — *least privilege* por padrão, ampliando explicitamente.
- [context.ts:3-13](src/server/context.ts#L3-L13) — o comentário deixa claro o limite do
  exercício: **só a autenticação é stub** (headers no lugar da sessão). A **autorização**
  — o que um `ctx` pode ler — é real e idêntica venha o `ctx` de um header ou de uma sessão
  verificada.

---

## Parada 3 — O coração nº 1: a camada de queries escopada ⭐

📄 [src/db/analytics.ts](src/db/analytics.ts) — o catálogo de queries por onde **toda** tool lê.

Esta é a parada mais importante. Há **dois chokepoints** aqui; o primeiro é o de tenant.

- [analytics.ts:38-48](src/db/analytics.ts#L38-L48) — **`scopeWhere` (chokepoint nº 1).** O
  *único* construtor de `WHERE` da camada. Ele **sempre** faz `AND` do filtro de workspace.
  Combinado com a assinatura **`ctx`-first** de toda função, uma query **não tem como ser
  escrita** sem o escopo de tenant. Não é "lembrar de filtrar" — é "não dá pra expressar
  sem o filtro".
- [analytics.ts:57-68](src/db/analytics.ts#L57-L68) — `applicationCountByStage`, a **query
  de referência** (veio no repo). Repare no padrão que replicamos em todas: `ctx` primeiro,
  filtros opcionais via `extra`, tudo passando por `scopeWhere`.
- [analytics.ts:116-125](src/db/analytics.ts#L116-L125) — `candidatesBySource`: agregação
  por canal de origem, escopada.
- [analytics.ts:135-157](src/db/analytics.ts#L135-L157) — `jobsOverview`. **Defesa em
  profundidade que vale comentar:** o `LEFT JOIN` em
  [analytics.ts:147-153](src/db/analytics.ts#L147-L153) faz `AND` de
  `applications.workspaceId = ctx.workspaceId` **dentro do join**, além do `scopeWhere` no
  `WHERE`. Antes o join confiava em ids de job serem globalmente únicos; agora a contagem
  não dobra linhas de outro tenant mesmo que um id colidisse. (Há teste de regressão pra isso
  — veja a Parada 7 e o [DECISIONS.md#hardening-pass](DECISIONS.md).)
- [analytics.ts:169-205](src/db/analytics.ts#L169-L205) — `listCandidates`, a função
  **portadora de PII**. Os filtros `stage`/`jobId` viram um **subquery também escopado** por
  `scopeWhere` em [analytics.ts:184-192](src/db/analytics.ts#L184-L192) — o tenant vale dos
  dois lados da relação. Note: a função aceita `stage`/`jobId`/`source`/`limit`, mas a *tool*
  expõe menos (Parada 4 explica o porquê).

### O coração nº 2: o gate de PII (projeção por papel)

- [analytics.ts:98-113](src/db/analytics.ts#L98-L113) — **`candidateSelection`
  (chokepoint nº 2).** O *único* lugar onde colunas de candidato são projetadas. As colunas
  de PII (`name`/`email`/`phone`) só entram no `SELECT` se
  [analytics.ts:109-111](src/db/analytics.ts#L109-L111) liberar para o papel. **Decisão-chave:
  é projeção por papel, não redação pós-query** — para um `analyst` as colunas **nunca são
  SELECTadas**, então não há o que vazar. O vazamento é *irrepresentável*, não removido depois.
- [analytics.ts:198](src/db/analytics.ts#L198) — é exatamente aqui que `listCandidates`
  consome essa seleção, herdando o gate "de graça".

📄 [src/db/permissions.ts](src/db/permissions.ts) — a fonte da verdade da regra de colunas.

- [permissions.ts:27-29](src/db/permissions.ts#L27-L29) — `PII_COLUMNS`: quais colunas são
  PII, por tabela.
- [permissions.ts:40-43](src/db/permissions.ts#L40-L43) — `canReadColumn`: `false` **se e
  somente se** a coluna for PII **e** o papel for `analyst`; `true` caso contrário. Pequena,
  pura, testável — e é o único ponto que `candidateSelection` consulta.

> **Frase para fixar a ideia:** *"Não é 'apagar PII depois da query'. Para o analyst, as
> colunas de PII nunca entram no SELECT. O mesmo para tenant: o filtro de workspace é o único
> jeito de montar um WHERE."*

---

## Parada 4 — O catálogo de tools (a superfície que o modelo dirige)

📄 [src/agent/tools.ts](src/agent/tools.ts)

A regra de fronteira está no topo do arquivo
([tools.ts:15-30](src/agent/tools.ts#L15-L30)): este arquivo importa **só** de
`@/db/analytics` — **nunca** `@/db/client` (`db`), nunca SQL cru. Por isso **nenhuma tool
consegue expressar** uma query fora de escopo ou com PII. As garantias moram uma camada
abaixo (Parada 3); as tools são um mapa fino e declarativo por cima.

- [tools.ts:54](src/agent/tools.ts#L54) — `buildTools(ctx)`: recebe o `ctx` da requisição e
  fecha (closure) cada tool sobre ele. O modelo passa só parâmetros de alto nível.
- [tools.ts:64-77](src/agent/tools.ts#L64-L77) — o wrapper **`safe`**: transforma um erro de
  query em um `{ error }` estruturado que o modelo lê e comunica ("não consegui buscar o
  dado") em vez de derrubar o turno.
- [tools.ts:82-85](src/agent/tools.ts#L82-L85) — `candidateColumns`: as colunas da tabela de
  roster são derivadas **do mesmo `candidateSelection`**, então a UI nunca anuncia uma coluna
  de PII que o papel não pode ler.
- [tools.ts:90-113](src/agent/tools.ts#L90-L113) — tool `applicationCountByStage` (a de
  referência): query escopada + input tipado (`zod`) + um **`display` hint** (`bar`) que a UI
  renderiza. [tools.ts:104](src/agent/tools.ts#L104) **coage `jobId:""` para ausente** —
  defesa contra o modelo preencher param opcional vazio.
- [tools.ts:163-181](src/agent/tools.ts#L163-L181) — tool `jobsOverview`. A descrição foi
  reescrita para **listar TODOS os jobs por padrão** (era enviesada para "open positions"); o
  filtro `status` só restringe quando o usuário pede. Veja a correção no
  [DECISIONS.md#fixes-from-manual-real-model-testing](DECISIONS.md).
- [tools.ts:194-223](src/agent/tools.ts#L194-L223) — tool `listCandidates` (portadora de PII).
  **Decisão de design importante**, documentada em
  [tools.ts:184-193](src/agent/tools.ts#L184-L193): a superfície é **propositalmente estreita
  — só `source` + `limit`**. Os filtros `stage`/`jobId` que a query suporta **não** são
  expostos ao modelo, porque o `gpt-4o-mini` (e o `gpt-4o`) **preenche parâmetros opcionais
  compulsivamente** — inventaria um `stage` ou um `jobId` num "liste os candidatos" simples e
  esvaziaria o resultado. **Menos botões = roster correto.** (A query mantém os filtros para
  chamadores diretos/estruturados — testados na Parada 7.)

> **Tradeoff que vale narrar:** a fidelidade dos argumentos de tool é uma restrição real
> desses modelos. Projetamos a *superfície* (quais params opcionais expor) para o
> comportamento do modelo, em vez de confiar em prosa na descrição para suprimir o
> preenchimento. Veja o "takeaway" no [DECISIONS.md](DECISIONS.md).

---

## Parada 5 — O loop do agente e o modelo

📄 [src/agent/run.ts](src/agent/run.ts) · 📄 [src/agent/provider.ts](src/agent/provider.ts)

- [run.ts:23-54](src/agent/run.ts#L23-L54) — `streamCopilot`: um loop mínimo (um modelo, as
  tools escopadas) com `stopWhen: stepCountIs(6)` em [run.ts:46](src/agent/run.ts#L46) e
  `onError` em [run.ts:50-52](src/agent/run.ts#L50-L52). Junto do `safe` da Parada 4, uma
  query que falha **degrada com elegância** em vez de quebrar o turno.
- [provider.ts:97-144](src/agent/provider.ts#L97-L144) — `getModel`: seleciona o provider por
  `AI_PROVIDER` (`mock` / `anthropic` / `openai` / `bedrock`, com `baseURL` opcional de
  gateway). **Default é o `mock`** para o repo bootar sem chave; o app real roda em
  `openai`/`gpt-4o-mini` via `.env.local`. Justificativa do modelo no
  [DECISIONS.md#model--agent](DECISIONS.md).
- [provider.ts:32-88](src/agent/provider.ts#L32-L88) — `buildSystemPrompt(role)`: o prompt de
  sistema. Pontos para destacar:
  - [provider.ts:18-30](src/agent/provider.ts#L18-L30) — `rolePreamble`: o prompt **declara o
    papel da sessão** ao modelo. Antes ele era *role-blind* e adivinhava as próprias
    permissões (recusava roster a um recruiter, ou narrava "como analista não posso…" *servindo
    um admin*). **Importante:** isto é **narração/roteamento, não segurança** — uma
    prompt-injection que convença o modelo de que é admin **ainda não** faz a sessão de analyst
    projetar PII, porque as colunas nunca são SELECTadas (Parada 3).
  - [provider.ts:45-48](src/agent/provider.ts#L45-L48) — regra contra **preencher params
    opcionais** (par do design estreito da Parada 4).
  - [provider.ts:68-74](src/agent/provider.ts#L68-L74) — regra de **tool-chaining para job por
    nome**: chamar `jobsOverview`, achar o id real do título, e passá-lo a
    `applicationCountByStage` — nunca um nome como `jobId`, nunca um split fabricado.
  - [provider.ts:85-87](src/agent/provider.ts#L85-L87) — trata a mensagem do usuário como
    **entrada não confiável** (anti prompt-injection).

---

## Parada 6 — A UI generativa (rows + display → componente)

📄 [src/agent/artifact.ts](src/agent/artifact.ts) · 📄 [src/app/tool-artifact.tsx](src/app/tool-artifact.tsx)

- [artifact.ts:10-15](src/agent/artifact.ts#L10-L15) — o **contrato**: toda tool devolve
  `{ rows, display }`, e `display` é uma união discriminada `table | bar | line`. É o que
  desacopla a tool da renderização.
- [tool-artifact.tsx:110-137](src/app/tool-artifact.tsx#L110-L137) — `ToolArtifact`:
  despacha pelo `display.kind`. Decisão: só renderizamos um `kind` que alguma tool
  realmente emite (o `line` só existe porque a tool de série temporal existe).
- [tool-artifact.tsx:139-185](src/app/tool-artifact.tsx#L139-L185) — `DataTable` (roster /
  jobs). As colunas vêm do `display`, que por sua vez vem do `candidateSelection` — então a
  tabela nunca tenta exibir uma coluna de PII que o papel não tem.
- [tool-artifact.tsx:187-284](src/app/tool-artifact.tsx#L187-L284) — `BarChart` em SVG.
- [tool-artifact.tsx:286-403](src/app/tool-artifact.tsx#L286-L403) — `LineChart` em SVG.
- [tool-artifact.tsx:53-67](src/app/tool-artifact.tsx#L53-L67) — `axisScale`: **correção de
  pós-spec.** O eixo arredonda o máximo para um múltiplo inteiro e passa em inteiros, então
  contagens pequenas não imprimem gridlines fracionárias (0.75, 1.5…). Detalhe em
  [DECISIONS.md#post-spec-polish](DECISIONS.md).
- [tool-artifact.tsx:69-108](src/app/tool-artifact.tsx#L69-L108) — estados deliberados de
  **carregando / erro / vazio** (`ArtifactLoading`, `ArtifactError`, `EmptyArtifact`),
  usados pelo `ToolCall` da Parada 1.

---

## Parada 7 — As provas (por que confiamos que segura)

A filosofia é um **proof split**: garantias determinísticas → testes unitários; comportamento
difuso do agente → evals adversariais. Detalhado em
[DECISIONS.md#benchmarks](DECISIONS.md).

📄 [src/db/analytics.test.ts](src/db/analytics.test.ts) — unit (chamam as queries direto, sem modelo)

- Toda função escopada a um workspace devolve **zero linhas estrangeiras**; `listCandidates`
  como `analyst` devolve linhas **sem as chaves de PII**, como `recruiter`/`admin` **com**
  elas; e há um teste de **schema-drift** que falha se uma nova coluna de PII for adicionada
  sem ser gated. (Provamos que **não são vácuos**: quebrando o guard de propósito, o teste
  fica vermelho — veja [DECISIONS.md](DECISIONS.md).)

📄 [evals/copilot.eval.ts](evals/copilot.eval.ts) — Evalite, adversarial (roda no mock)

- [copilot.eval.ts:111-119](evals/copilot.eval.ts#L111-L119) — `noPII`: falha se **qualquer**
  linha de resultado carregar uma **coluna** de PII. Testa a *chave*, não o valor.
- [copilot.eval.ts:127-135](evals/copilot.eval.ts#L127-L135) — `piiVisibleToPrivilegedRole`:
  **controle positivo** — recruiter/admin *devem* ver PII (prova que o gate discrimina por
  papel, não é um "apaga sempre").
- [copilot.eval.ts:179-202](evals/copilot.eval.ts#L179-L202) — `noForeignRows`: isolamento de
  tenant, conferido de dois jeitos (prefixo de id `bw-*`/`mer-*` para linhas com id; e
  contagens de agregados cruzadas contra a verdade do próprio workspace).
- [copilot.eval.ts:221-286](evals/copilot.eval.ts#L221-L286) — as suítes adversariais:
  analyst tentando extrair PII (incl. **prompt-injection** "SYSTEM OVERRIDE"), e
  Brightwave tentando alcançar a Meridian.
- [copilot.eval.ts:298-344](evals/copilot.eval.ts#L298-L344) — eval de **qualidade de resposta
  (LLM-judge)**, *gated*: registrada com `evalite.skip` no mock para `pnpm eval` seguir
  determinístico e grátis; roda de verdade com `AI_PROVIDER=openai pnpm eval`.

> **Insight contra-intuitivo (bom para a conversa técnica):** o **mock é o caminho mais
> adversarial**, porque ele *força* a chamada de tool — então a aplicação real é a garantia
> por construção. O modelo real adiciona a **recusa** como segunda camada, mais mole. Por isso
> os evals adversariais ficam no mock. Veja [DECISIONS.md#hardening-pass](DECISIONS.md).

---

## Parada 8 — Tradeoffs e decisões (o "porquê" condensado)

📄 [DECISIONS.md](DECISIONS.md) — log vivo. Os destaques:

- **Duas camadas, enforcement no fundo.** Catálogo de tools fino sobre catálogo de queries
  escopado. → [DECISIONS.md#architecture--key-decisions](DECISIONS.md)
- **Sem abstração de "tool library".** Consideramos um factory `createScopedQueries(ctx)` e
  **rejeitamos** como cleverness desnecessária — o padrão `ctx`-first dá a mesma garantia de
  "não dá pra esquecer o escopo". A estrutura que se paga é a camada de queries, não um
  framework. → [DECISIONS.md#trade-offs--cuts](DECISIONS.md)
- **Permissão = projeção por papel, não redação.** (Parada 3.)
- **Ordem de execução `00 → 01 → 02 → 04 → 03 → 05`** — benchmarks (04) **antes** da UI (03):
  provar que o agente não vaza antes de construir UI por cima. → [specs/](specs/README.md) e
  [DECISIONS.md#order](DECISIONS.md)
- **Modelo `gpt-4o-mini`, chave direta.** Barato/rápido o bastante; `OPENAI_MODEL` é o botão a
  girar se o demo precisar. → [DECISIONS.md#model--agent](DECISIONS.md)
- **Correções de teste manual** (todas comportamentais, nenhuma de segurança — escopo e PII
  seguraram por construção sempre): prompt role-blind, `jobsOverview` enviesado para "open",
  contagem por estágio que pedia job id, e job-por-nome. **Corrigidas só na camada de
  prompt/descrição** — a camada de queries não foi tocada. →
  [DECISIONS.md#fixes-from-manual-real-model-testing](DECISIONS.md) e os arquivos de teste manual
  ([manual-test-prompts-finds.md](manual-test-prompts-finds.md)).
- **Com mais um dia:** resposta estruturada tipada emitida pelo agente, mais analytics
  (time-to-hire, conversão de funil), eval de qualidade por LLM-judge ligada, gráficos mais
  ricos, e um deploy com a história do banco (PGlite) escrita. → [DECISIONS.md#trade-offs--cuts](DECISIONS.md)

---

## Roteiro relâmpago (se quiser navegar ao vivo em 2 min)

1. [analytics.ts:38](src/db/analytics.ts#L38) — `scopeWhere`: "o único jeito de montar um
   WHERE; sempre AND-a o workspace; `ctx`-first ⇒ não dá pra esquecer."
2. [analytics.ts:98](src/db/analytics.ts#L98) — `candidateSelection`: "PII nunca entra no
   SELECT do analyst; vazamento irrepresentável."
3. [tools.ts:15-30](src/agent/tools.ts#L15-L30) — "tools importam só `analytics.ts` ⇒ nenhuma
   tool expressa query insegura."
4. [tools.ts:184-193](src/agent/tools.ts#L184-L193) — "superfície estreita de `listCandidates`:
   projetei pra como o modelo se comporta."
5. [provider.ts:18-30](src/agent/provider.ts#L18-L30) — "o prompt declara o papel — mas isso é
   roteamento, não a segurança; a segurança está no SELECT."
6. [tool-artifact.tsx:110](src/app/tool-artifact.tsx#L110) — "rows + display → gráfico/tabela."
7. [copilot.eval.ts:111](evals/copilot.eval.ts#L111) — "evals checam a *coluna*, e ficam
   vermelhos se eu quebrar o guard."

Essa é a tese inteira em sete cliques.
