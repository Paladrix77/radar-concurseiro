# Radar do Concurseiro

Site para concurseiros: lista os concursos das bancas, vigia nomes e termos no Diário Oficial da União e mostra no site quando sai edital, retificação ou resultado novo.

Feito com Cloudflare Workers + D1, em um arquivo só (`worker.js`).

## Como publicar
1. Crie o banco: `wrangler d1 create radar-concurseiro` e rode `wrangler d1 execute radar-concurseiro --remote --file schema.sql`.
2. Confira o id do banco no `wrangler.toml`.
3. `wrangler secret put ADMIN_KEY` (senha para as rotas de admin).
4. `wrangler deploy`.
5. Abra `/admin/rodar?key=SUA_SENHA&dou` para testar.

## Telegram (opcional, desativado)
Os avisos funcionam dentro do site, na aba Meus alertas. Para ligar o Telegram depois: crie um bot no @BotFather, `wrangler secret put TELEGRAM_TOKEN`, coloque `BOT_USERNAME` no `wrangler.toml` e abra `/admin/telegram?key=SUA_SENHA` uma vez.

## Fontes
As bancas ficam na lista `FONTES` no começo do `worker.js`. A aba Novidades mostra quantos concursos cada fonte achou na última rodada.

## Como o robô funciona
- Roda completo de hora em hora (minuto 7): lê as bancas, o DOU e os detalhes de cada concurso (cargos, inscrições, documentos).
- Nos outros minutos só adianta detalhes pendentes e atende **sondas**: linhas na tabela `sondas` (url, modo) que o robô baixa e resume, usadas para investigar sites novos.
- Bancas lidas: Cebraspe (API), FGV, FCC e Vunesp. IBFC, Idecan, Consulplan, Quadrix e Fundatec bloqueiam robôs; o Instituto AOCP monta a lista por JavaScript.
