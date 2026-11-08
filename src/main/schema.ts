import type Database from 'better-sqlite3'

export const MIGRATIONS: ((d: Database.Database) => void)[] = [
  (d) => {
    d.exec(`
      CREATE TABLE deck (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES deck(id),
        name TEXT NOT NULL,
        color TEXT,
        new_per_day INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE note (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        fields TEXT NOT NULL,
        tags TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE note_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id TEXT NOT NULL,
        fields TEXT NOT NULL,
        changed_at INTEGER NOT NULL
      );
      CREATE TABLE card (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL REFERENCES note(id),
        deck_id TEXT NOT NULL REFERENCES deck(id),
        ord INTEGER NOT NULL DEFAULT 0,
        state INTEGER NOT NULL DEFAULT 0,
        due INTEGER NOT NULL,
        stability REAL NOT NULL DEFAULT 0,
        difficulty REAL NOT NULL DEFAULT 0,
        elapsed_days INTEGER NOT NULL DEFAULT 0,
        scheduled_days INTEGER NOT NULL DEFAULT 0,
        learning_steps INTEGER NOT NULL DEFAULT 0,
        reps INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        last_review INTEGER,
        suspended INTEGER NOT NULL DEFAULT 0,
        buried_until INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX idx_card_queue ON card(deck_id, state, due);
      CREATE INDEX idx_card_note ON card(note_id);
      CREATE TABLE review (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES card(id),
        reviewed_at INTEGER NOT NULL,
        rating INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        state_before TEXT NOT NULL,
        was_new INTEGER NOT NULL DEFAULT 0,
        prev_state INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_review_time ON review(reviewed_at);
      CREATE INDEX idx_review_card ON review(card_id);
      CREATE TABLE media (
        hash TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE note_fts USING fts5(
        note_id UNINDEXED, content, tags,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `)
  }
  ,
  (d) => {
    d.exec(`
      ALTER TABLE card ADD COLUMN meta_at INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE card ADD COLUMN reset_at INTEGER NOT NULL DEFAULT 0;
      UPDATE card SET meta_at = created_at;
      ALTER TABLE note ADD COLUMN source TEXT;
      CREATE INDEX idx_note_source ON note(source);
      CREATE TABLE subject (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#c96442',
        coefficient REAL NOT NULL DEFAULT 1,
        deck_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE entry (
        id TEXT PRIMARY KEY,
        subject_id TEXT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        due_at INTEGER,
        status TEXT NOT NULL DEFAULT 'todo',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX idx_entry_due ON entry(due_at);
      CREATE TABLE entry_link (
        entry_id TEXT NOT NULL,
        deck_id TEXT NOT NULL,
        PRIMARY KEY (entry_id, deck_id)
      );
      CREATE TABLE task (
        id TEXT PRIMARY KEY,
        subject_id TEXT,
        title TEXT NOT NULL,
        due_at INTEGER,
        done INTEGER NOT NULL DEFAULT 0,
        recurrence TEXT NOT NULL DEFAULT 'none',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE TABLE device (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_sync INTEGER,
        is_self INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE ai_call (
        id TEXT PRIMARY KEY,
        at INTEGER NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        purpose TEXT NOT NULL DEFAULT ''
      );
    `)
  }
  ,
  (d) => {
    d.exec(`
      CREATE TABLE document (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        remote_id TEXT,
        subject TEXT NOT NULL DEFAULT '',
        folder TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        filename TEXT NOT NULL,
        ext TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL DEFAULT 0,
        path TEXT NOT NULL,
        text TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        published_at INTEGER,
        added_at INTEGER NOT NULL,
        deck_id TEXT,
        cards INTEGER NOT NULL DEFAULT 0,
        deleted_at INTEGER
      );
      CREATE UNIQUE INDEX idx_document_remote ON document(source, remote_id) WHERE remote_id IS NOT NULL;
      CREATE INDEX idx_document_subject ON document(subject);
    `)
  },
  // v4 : notes personnelles écrites dans un document
  (db) => {
    db.exec(`ALTER TABLE document ADD COLUMN notes TEXT NOT NULL DEFAULT ''`)
  },
  // v5 : tri des documents (catégorie, chapitre) et détection des doublons
  (db) => {
    db.exec(`
      ALTER TABLE document ADD COLUMN category TEXT NOT NULL DEFAULT '';
      ALTER TABLE document ADD COLUMN chapter TEXT NOT NULL DEFAULT '';
      ALTER TABLE document ADD COLUMN hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE document ADD COLUMN text_hash TEXT NOT NULL DEFAULT '';
      ALTER TABLE document ADD COLUMN dup_of TEXT;
      ALTER TABLE document ADD COLUMN cards_tried INTEGER NOT NULL DEFAULT 0;
    `)
  },
  // v6 : tri plus strict (dossier, contenu) : les documents « à apprendre » sont reclassés au prochain passage
  (db) => {
    db.exec(`UPDATE document SET category = '', chapter = '', deck_id = NULL WHERE category IN ('cours', 'methode', 'vocabulaire', 'autre') AND dup_of IS NULL`)
  }
]
