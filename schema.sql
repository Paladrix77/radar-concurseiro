CREATE TABLE IF NOT EXISTS concursos (
  id TEXT PRIMARY KEY,
  banca TEXT NOT NULL,
  nome TEXT NOT NULL,
  url TEXT NOT NULL,
  situacao TEXT,
  uf TEXT,
  primeiro_visto TEXT NOT NULL,
  ultimo_visto TEXT NOT NULL,
  docs_json TEXT,
  docs_checado TEXT
);
CREATE INDEX IF NOT EXISTS idx_concursos_visto ON concursos(ultimo_visto);
CREATE TABLE IF NOT EXISTS usuarios (
  token TEXT PRIMARY KEY,
  chat_id TEXT,
  avisar_novos INTEGER NOT NULL DEFAULT 1,
  criado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS acompanhando (
  token TEXT NOT NULL,
  concurso_id TEXT NOT NULL,
  criado TEXT NOT NULL,
  PRIMARY KEY (token, concurso_id)
);
CREATE TABLE IF NOT EXISTS termos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL,
  termo TEXT NOT NULL,
  criado TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  concurso_id TEXT,
  token TEXT,
  titulo TEXT NOT NULL,
  url TEXT,
  trecho TEXT,
  criado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eventos_token ON eventos(token, id);
CREATE TABLE IF NOT EXISTS dou_vistos (
  token TEXT NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (token, url)
);
CREATE TABLE IF NOT EXISTS estado (chave TEXT PRIMARY KEY, valor TEXT);
CREATE TABLE IF NOT EXISTS fontes_log (
  fonte TEXT PRIMARY KEY,
  quando TEXT,
  links INTEGER,
  erro TEXT
);
