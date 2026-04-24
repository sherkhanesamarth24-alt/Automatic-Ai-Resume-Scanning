-- RecruitAI Database Schema (Updated)
-- Run: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS recruitai CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE recruitai;

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(100)        NOT NULL,
  email            VARCHAR(255) UNIQUE NOT NULL,
  password_hash    VARCHAR(255)        NOT NULL,
  is_verified      TINYINT(1)          DEFAULT 0,
  otp              VARCHAR(6),
  otp_expires_at   DATETIME,
  created_at       DATETIME            DEFAULT CURRENT_TIMESTAMP
);

-- ── Admins ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admins (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(100)        NOT NULL,
  email            VARCHAR(255) UNIQUE NOT NULL,
  password_hash    VARCHAR(255)        NOT NULL,
  created_at       DATETIME            DEFAULT CURRENT_TIMESTAMP
);

-- Default admin (password: Admin@1234)
INSERT IGNORE INTO admins (name, email, password_hash)
VALUES ('Admin', 'admin@recruitai.com', '$2a$12$Vp.eSmkTT56OEqfHuPVh1.sWlyXP5bOaMiqfhO0a3UqZT7zxjKFXq');

-- ── Resumes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resumes (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED        NOT NULL,
  candidate_name   VARCHAR(150)        NOT NULL,
  candidate_email  VARCHAR(255)        NOT NULL,
  job_role         VARCHAR(150)        NOT NULL,
  skills           JSON,
  experience       TINYINT UNSIGNED    DEFAULT 0,
  education        VARCHAR(100),
  certifications   VARCHAR(500)        DEFAULT '',
  projects         TEXT,
  cover_note       TEXT,
  score            TINYINT UNSIGNED    DEFAULT 0,
  score_breakdown  JSON,
  status           ENUM('pending','selected','rejected') DEFAULT 'pending',
  file_path        VARCHAR(500),
  created_at       DATETIME            DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user   (user_id),
  INDEX idx_score  (score),
  INDEX idx_status (status),
  INDEX idx_date   (created_at)
);

-- ── Notifications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED        NOT NULL,
  title            VARCHAR(200)        NOT NULL,
  body             TEXT,
  type             ENUM('success','warning','info','error') DEFAULT 'info',
  is_read          TINYINT(1)          DEFAULT 0,
  created_at       DATETIME            DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_n (user_id)
);
