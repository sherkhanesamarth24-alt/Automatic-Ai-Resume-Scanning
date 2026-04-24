require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Serve index.html from same folder
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const JWT_SECRET = process.env.JWT_SECRET || 'recruitai-secret-change-me';
const PORT = process.env.PORT || 3000;

// ── Database ─────────────────────────────────────────────────────────────────
let pool;
(async () => {
  try {
    pool = await mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'recruitai',
      waitForConnections: true,
      connectionLimit: 10,
    });
    console.log('✅  MySQL connected');
  } catch (err) {
    console.error('❌  MySQL connection failed:', err.message);
  }
})();

// ── Email Transporter ────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function sendOTPEmail(toEmail, toName, otp) {
  const html = `
  <!DOCTYPE html>
  <html>
  <body style="font-family:'Segoe UI',sans-serif;background:#f7f8fa;margin:0;padding:40px 20px;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
      <div style="background:linear-gradient(135deg,#1e6fb5,#0f9e75);padding:32px 40px;">
        <div style="font-size:24px;font-weight:800;color:white;letter-spacing:-0.5px;">🧠 RecruitAI</div>
        <div style="color:rgba(255,255,255,0.75);font-size:14px;margin-top:4px;">AI Resume Screening System</div>
      </div>
      <div style="padding:40px;">
        <h2 style="font-size:22px;font-weight:700;color:#0d1b2a;margin:0 0 8px;">Verify your email</h2>
        <p style="color:#64748b;font-size:15px;line-height:1.6;margin:0 0 32px;">Hi ${toName}, enter this 6-digit code to verify your RecruitAI account.</p>
        <div style="background:#f7f8fa;border-radius:12px;padding:28px;text-align:center;margin-bottom:28px;">
          <div style="font-size:42px;font-weight:800;letter-spacing:12px;color:#0d1b2a;font-family:'Courier New',monospace;">${otp}</div>
          <div style="font-size:13px;color:#94a3b8;margin-top:10px;">Valid for <strong>10 minutes</strong></div>
        </div>
        <p style="color:#94a3b8;font-size:13px;line-height:1.6;">If you didn't register on RecruitAI, you can safely ignore this email.</p>
      </div>
    </div>
  </body>
  </html>`;
  await transporter.sendMail({
    from: `"RecruitAI" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: `${otp} — Your RecruitAI verification code`,
    html,
  });
}

// ── File Upload ──────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s/g,'_')}`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, ['.pdf','.doc','.docx'].includes(ext));
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ── Middleware ───────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

// ── ATS Scoring Engine ───────────────────────────────────────────────────────
function scoreResume({ skills=[], experience=0, education='', certifications='', projects='', cover_note='' }) {
  const HIGH = ['python','react','node.js','machine learning','aws','kubernetes','docker','tensorflow','sql','typescript','java','golang','rust','scala','spark','kafka','redis','postgresql','mongodb','angular','vue','devops','flutter','swift','kotlin'];
  const MID  = ['css','html','git','linux','excel','jira','agile','scrum','rest','api','php','mysql','jquery','firebase'];

  // Skills: max 40
  let skillScore = 0;
  skills.forEach(sk => {
    const s = sk.toLowerCase().trim();
    if (HIGH.some(h => s.includes(h))) skillScore += 6;
    else if (MID.some(m => s.includes(m))) skillScore += 3;
    else skillScore += 2;
  });
  skillScore = Math.min(skillScore, 40);

  // Experience: max 25
  const exp = parseInt(experience) || 0;
  let expScore = 0;
  if(exp>=10) expScore=25; else if(exp>=7) expScore=22; else if(exp>=5) expScore=18;
  else if(exp>=3) expScore=14; else if(exp>=2) expScore=10; else if(exp>=1) expScore=6;

  // Education: max 18
  const edu = education.toLowerCase();
  let eduScore = 0;
  if(edu.includes('phd')||edu.includes('doctorate')) eduScore=18;
  else if(edu.includes("master")) eduScore=15;
  else if(edu.includes("bachelor")) eduScore=12;
  else if(edu.includes("diploma")) eduScore=7;
  else if(edu.includes("high school")) eduScore=4;

  // Certifications: max 8
  const certs = certifications.split(',').map(c=>c.trim()).filter(Boolean);
  const certScore = Math.min(certs.length * 3, 8);

  // Projects: max 6
  let projScore = 0;
  if(projects.length>100) projScore=6;
  else if(projects.length>50) projScore=4;
  else if(projects.length>10) projScore=2;

  // Cover Note: max 3
  let coverScore = 0;
  if(cover_note.length>100) coverScore=3;
  else if(cover_note.length>40) coverScore=1;

  const total = Math.min(100, skillScore+expScore+eduScore+certScore+projScore+coverScore);
  return { total, breakdown: { skills:skillScore, exp:expScore, edu:eduScore, certs:certScore, projects:projScore, cover:coverScore } };
}

// ════════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── Register ─────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name||!email||!password) return res.status(400).json({ error: 'All fields are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Invalid email address' });
  try {
    const [existing] = await pool.query('SELECT id,is_verified FROM users WHERE email=?', [email]);
    if (existing.length && existing[0].is_verified) return res.status(409).json({ error: 'Email already registered. Please sign in.' });

    const hash = await bcrypt.hash(password, 12);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExp = new Date(Date.now() + 10 * 60 * 1000);

    if (existing.length) {
      await pool.query('UPDATE users SET name=?,password_hash=?,otp=?,otp_expires_at=? WHERE email=?', [name,hash,otp,otpExp,email]);
    } else {
      await pool.query('INSERT INTO users (name,email,password_hash,otp,otp_expires_at) VALUES (?,?,?,?,?)', [name,email,hash,otp,otpExp]);
    }

    try {
      await sendOTPEmail(email, name, otp);
      console.log(`✅ OTP email sent to ${email}`);
    } catch (emailErr) {
      console.log('==============================');
      console.log(`📌 EMAIL FAILED — USE THIS OTP`);
      console.log(`👤 User  : ${email}`);
      console.log(`🔑 OTP   : ${otp}`);
      console.log('==============================');
    }
    res.json({ message: 'OTP sent! Check your email or VS Code terminal.' });
  } catch (err) {
    console.error('Register error:', err);
    if (err.message.includes('sendMail') || err.message.includes('EAUTH')) {
      return res.status(500).json({ error: 'Failed to send email. Check EMAIL_USER and EMAIL_PASS in .env' });
    }
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── Resend OTP ───────────────────────────────────────────────────────────────
app.post('/api/auth/resend-otp', async (req, res) => {
  const { email } = req.body;
  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
    if (!user) return res.status(404).json({ error: 'Email not found' });
    if (user.is_verified) return res.status(400).json({ error: 'Already verified' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExp = new Date(Date.now() + 10 * 60 * 1000);
    await pool.query('UPDATE users SET otp=?,otp_expires_at=? WHERE email=?', [otp,otpExp,email]);
    try {
      await sendOTPEmail(email, user.name, otp);
      console.log(`✅ OTP resent to ${email}`);
    } catch (emailErr) {
      console.log('==============================');
      console.log(`📌 RESEND FAILED — USE THIS OTP`);
      console.log(`👤 User  : ${email}`);
      console.log(`🔑 OTP   : ${otp}`);
      console.log('==============================');
    }
    res.json({ message: 'New OTP sent! Check email or VS Code terminal.' });
  } catch (err) {
    console.error('Resend OTP error:', err);
    res.status(500).json({ error: 'Failed to resend OTP' });
  }
});

// ── Verify OTP ───────────────────────────────────────────────────────────────
app.post('/api/auth/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.is_verified) return res.status(400).json({ error: 'Email already verified. Please sign in.' });
    if (user.otp !== otp) return res.status(400).json({ error: 'Invalid OTP. Check your email and try again.' });
    if (new Date() > new Date(user.otp_expires_at)) return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    await pool.query('UPDATE users SET is_verified=1,otp=NULL,otp_expires_at=NULL WHERE email=?', [email]);
    const token = jwt.sign({ id:user.id, email:user.email, name:user.name, is_admin:false }, JWT_SECRET, { expiresIn:'7d' });
    res.json({ token, user: { id:user.id, name:user.name, email:user.email } });
  } catch (err) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Login ────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email||!password) return res.status(400).json({ error: 'Email and password are required' });
  try {
    const [[user]] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
    if (!user) return res.status(401).json({ error: 'No account found with this email' });
    if (!user.is_verified) return res.status(403).json({ error: 'Email not verified. Please check your inbox for the OTP.' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Incorrect password' });
    const token = jwt.sign({ id:user.id, email:user.email, name:user.name, is_admin:user.is_admin||false }, JWT_SECRET, { expiresIn:'7d' });
    res.json({ token, user: { id:user.id, name:user.name, email:user.email } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Admin Login ───────────────────────────────────────────────────────────────
app.post('/api/auth/admin-login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const [[admin]] = await pool.query('SELECT * FROM admins WHERE email=?', [email]);
    if (!admin) return res.status(401).json({ error: 'Invalid admin credentials' });
    const ok = await bcrypt.compare(password, admin.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid admin credentials' });
    const token = jwt.sign({ id:admin.id, email:admin.email, name:admin.name, is_admin:true }, JWT_SECRET, { expiresIn:'1d' });
    res.json({ token, admin: { id:admin.id, name:admin.name, email:admin.email } });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Upload Resume ─────────────────────────────────────────────────────────────
app.post('/api/resumes/upload', auth, upload.single('resume'), async (req, res) => {
  const { candidate_name, candidate_email, job_role, skills, experience, education, certifications, projects, cover_note } = req.body;
  if (!candidate_name||!candidate_email||!job_role||!skills||!education) {
    return res.status(400).json({ error: 'Required fields missing' });
  }
  try {
    const today = new Date().toISOString().split('T')[0];
    const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM resumes WHERE user_id=? AND DATE(created_at)=?', [req.user.id, today]);
    if (count >= 10) return res.status(429).json({ error: 'Daily upload limit of 10 reached' });

    const skillArr = skills.split(',').map(s=>s.trim()).filter(Boolean);
    const { total:score, breakdown } = scoreResume({ skills:skillArr, experience, education, certifications:certifications||'', projects:projects||'', cover_note:cover_note||'' });
    const status = score > 25 ? 'pending' : 'rejected';
    const filePath = req.file ? req.file.path : null;

    const [result] = await pool.query(
      `INSERT INTO resumes (user_id,candidate_name,candidate_email,job_role,skills,experience,education,certifications,projects,cover_note,score,score_breakdown,status,file_path)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [req.user.id, candidate_name, candidate_email, job_role, JSON.stringify(skillArr), experience, education, certifications||'', projects||'', cover_note||'', score, JSON.stringify(breakdown), status, filePath]
    );

    await pool.query(
      'INSERT INTO notifications (user_id,title,body,type) VALUES (?,?,?,?)',
      [req.user.id, `ATS Score: ${score}/100`, `${candidate_name} for ${job_role} — ${score>25?'Shortlisted':'Below threshold'}`, score>60?'success':score>25?'info':'warning']
    );

    res.json({ id:result.insertId, score, breakdown, status, message:`Resume evaluated. ATS Score: ${score}/100` });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Server error during upload' });
  }
});

// ── My Resumes ────────────────────────────────────────────────────────────────
app.get('/api/resumes/my', auth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM resumes WHERE user_id=? ORDER BY created_at DESC', [req.user.id]);
    res.json(rows.map(r => ({ ...r, skills: JSON.parse(r.skills||'[]'), breakdown: JSON.parse(r.score_breakdown||'{}') })));
  } catch (err) { res.status(500).json({ error: 'Server error' }); }
});

// ── Daily Count ───────────────────────────────────────────────────────────────
app.get('/api/resumes/daily-count', auth, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const [[{ count }]] = await pool.query('SELECT COUNT(*) as count FROM resumes WHERE user_id=? AND DATE(created_at)=?', [req.user.id, today]);
  res.json({ count: parseInt(count), limit: 10 });
});

// ── Notifications ─────────────────────────────────────────────────────────────
app.get('/api/notifications', auth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20', [req.user.id]);
  res.json(rows);
});
app.put('/api/notifications/read-all', auth, async (req, res) => {
  await pool.query('UPDATE notifications SET is_read=1 WHERE user_id=?', [req.user.id]);
  res.json({ success: true });
});

// ── Admin: All Candidates ─────────────────────────────────────────────────────
app.get('/api/admin/candidates', adminAuth, async (req, res) => {
  const { search='', score_filter='all', status='all' } = req.query;
  let q = 'SELECT r.*,u.name as user_name FROM resumes r JOIN users u ON r.user_id=u.id WHERE 1=1';
  const params = [];
  if (search) { q+=' AND (r.candidate_name LIKE ? OR r.job_role LIKE ? OR r.candidate_email LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if (status!=='all') { q+=' AND r.status=?'; params.push(status); }
  if (score_filter==='high') q+=' AND r.score>=70';
  else if (score_filter==='mid') q+=' AND r.score>=40 AND r.score<70';
  else if (score_filter==='low') q+=' AND r.score<40';
  q+=' ORDER BY r.score DESC LIMIT 100';
  const [rows] = await pool.query(q, params);
  res.json(rows.map(r=>({...r,skills:JSON.parse(r.skills||'[]'),breakdown:JSON.parse(r.score_breakdown||'{}')})));
});

app.put('/api/admin/candidates/:id/status', adminAuth, async (req, res) => {
  const { status } = req.body;
  if (!['selected','rejected','pending'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  await pool.query('UPDATE resumes SET status=? WHERE id=?', [status, req.params.id]);
  res.json({ success: true });
});

app.get('/api/admin/analytics', adminAuth, async (req, res) => {
  const [[totals]] = await pool.query(`SELECT COUNT(*) as total,AVG(score) as avg_score,SUM(status='selected') as selected,SUM(status='rejected') as rejected,SUM(DATE(created_at)=CURDATE()) as today FROM resumes`);
  const [topRoles] = await pool.query('SELECT job_role,COUNT(*) as cnt FROM resumes GROUP BY job_role ORDER BY cnt DESC LIMIT 5');
  res.json({ totals, topRoles });
});

// ════════════════════════════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`🚀  RecruitAI running → http://localhost:${PORT}`);
  console.log(`📧  Email: ${process.env.EMAIL_USER||'Not configured'}`);
  console.log(`🗄️   DB: ${process.env.DB_NAME||'recruitai'}@${process.env.DB_HOST||'localhost'}`);
});