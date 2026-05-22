import React, { useState, useEffect, useCallback, useContext, createContext } from 'react';
import ReactDOM from 'react-dom/client';
import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';

import logoUrl from '../img/logo.png';
import logo3Url from '../img/logo3.png';
import backUrl from '../img/back.png';

import ViewVistoria from './vistoria/ViewVistoria';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

// Mantém XLSX acessível para o código existente que faz `XLSX.read(...)` direto.
if (typeof window !== 'undefined') {
  window.XLSX = XLSX;
}

// Erro sinalizador de sessão ausente/expirada ao chamar Edge Functions.
class SessaoExpiradaError extends Error {
  constructor() {
    super('SESSAO_EXPIRADA');
    this.name = 'SessaoExpiradaError';
  }
}

// Garante que o invoke das Edge Functions vá com o JWT do usuário logado.
// A VITE_SUPABASE_PUBLISHABLE_KEY (sb_publishable_...) NÃO é um JWT; se o invoke
// cair nesse fallback (sessão inválida), o gateway do Supabase barra com 403
// ("Edge Function returned a non-2xx status code"). Pegamos o access_token da
// sessão atual e o enviamos explicitamente no header Authorization.
async function obterAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();

  let token = data?.session?.access_token;

  // Sessão presente mas (quase) expirada — tenta renovar uma vez.
  if (!token || (data?.session?.expires_at && data.session.expires_at * 1000 < Date.now() + 5000)) {
    const { data: refreshed } = await supabase.auth.refreshSession();
    token = refreshed?.session?.access_token || token;
  }

  if (error || !token) {
    throw new SessaoExpiradaError();
  }

  return { Authorization: `Bearer ${token}` };
}

function removerAcentos(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function limparTextoArquivo(texto = '') {
  return removerAcentos(texto)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
function normalizarCnpj(valor = '') {
  return String(valor || '').replace(/\D/g, '');
}
function normalizarBusca(valor = '') {
  return removerAcentos(String(valor || ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function consultorPertenceAoUsuario(consultor = '', user = {}) {
  const textoConsultor = normalizarBusca(consultor);
  const nomeUsuario = normalizarBusca(user?.nome || user?.name);
  const emailUsuario = normalizarBusca(user?.email);

  if (!textoConsultor) return false;

  return (
    textoConsultor === nomeUsuario ||
    textoConsultor.includes(nomeUsuario) ||
    nomeUsuario.includes(textoConsultor) ||
    (!!emailUsuario && textoConsultor.includes(emailUsuario))
  );
}
function inteiroTexto(v) {
  const s = String(v ?? '').trim();

  if (s === '') return '';

  const n = Number(String(s).replace(',', '.'));

  return Number.isFinite(n) && Number.isInteger(n)
    ? String(n)
    : s;
}

function normalizarVelocidade(valor) {
  let texto = String(valor ?? '')
    .trim()
    .toLowerCase()
    .replace(',', '.');

  if (!texto) return '';

  texto = texto.replace(/\s+/g, ' ');

  const match = texto.match(/^([\d.]+)\s*(mb|mbps|mega|megas|gb|gbps|giga|gigas)?$/i);

  if (!match) {
    const numero = Number(texto.replace(/[^\d.]/g, ''));

    return Number.isFinite(numero)
      ? String(Math.round(numero))
      : '';
  }

  const numero = Number(match[1]);
  const unidade = String(match[2] || '').toLowerCase();

  if (!Number.isFinite(numero)) return '';

  if (['gb', 'gbps', 'giga', 'gigas'].includes(unidade)) {
    return String(Math.round(numero * 1000));
  }

  return String(Math.round(numero));
}
function extrairAnoMesDaCompetencia(competencia = '') {
  const valor = String(competencia || '').trim();

  const mesesNome = {
    JANEIRO: '01',
    FEVEREIRO: '02',
    MARCO: '03',
    MARÇO: '03',
    ABRIL: '04',
    MAIO: '05',
    JUNHO: '06',
    JULHO: '07',
    AGOSTO: '08',
    SETEMBRO: '09',
    OUTUBRO: '10',
    NOVEMBRO: '11',
    DEZEMBRO: '12',
  };

  // Formato: 2026-02
  let match = valor.match(/^(\d{4})-(\d{1,2})$/);
  if (match) {
    return {
      ano: match[1],
      mes: String(Number(match[2])).padStart(2, '0'),
    };
  }

  // Formato: 02/2026
  match = valor.match(/^(\d{1,2})\/(\d{4})$/);
  if (match) {
    return {
      ano: match[2],
      mes: String(Number(match[1])).padStart(2, '0'),
    };
  }

  // Formato: Fevereiro/2026
  match = valor.match(/^([A-Za-zÀ-ÿ]+)\/(\d{4})$/);
  if (match) {
    const mesTexto = removerAcentos(match[1]).toUpperCase();
    return {
      ano: match[2],
      mes: mesesNome[mesTexto] || '00',
    };
  }

  return {
    ano: '0000',
    mes: '00',
  };
}

function montarNomeArquivoPadrao({ competencia, ano, mes, empresa }) {
  let anoFinal = ano;
  let mesFinal = mes;

  if (!anoFinal || !mesFinal) {
    const extraido = extrairAnoMesDaCompetencia(competencia);
    anoFinal = extraido.ano;
    mesFinal = extraido.mes;
  }

  anoFinal = String(anoFinal || '0000').trim();
  mesFinal = String(mesFinal || '00').trim().padStart(2, '0');

  // Transforma 2026 em 26
  const anoCurto = anoFinal.length === 4
    ? anoFinal.slice(2)
    : anoFinal.slice(-2).padStart(2, '0');

  // Garante mês com 2 dígitos
  const mesCurto = mesFinal.padStart(2, '0');

  const competenciaArquivo = `${anoCurto}${mesCurto}`;

  const empresaLimpa = limparTextoArquivo(empresa || 'CLIENTE');

  return `POS_${competenciaArquivo}_DICI-SCM_${empresaLimpa}_PL.csv`;
}

/* ==============================
   DADOS MOCK
   ============================== */
const MOCK_USERS = {
  admin: { id: 'u1', name: 'Cláudio', email: 'claudio@scmengenharia.com.br', role: 'admin', initials: 'CL', cnpj: null },
  consult: { id: 'u2', name: 'Ana Paula — SCM', email: 'apaula@scmengenharia.com.br', role: 'consult', initials: 'AP', cnpj: null },
  client: { id: 'u3', name: 'Severino Ramilio', email: 'contato@setwifi.com.br', role: 'client', initials: 'SR', cnpj: '08.640.151/0001-16' },
};

const PERMISSIONS = {
  admin:      { editSite: true,  manageUsers: true,  viewAll: true,  downloadDici: true,  deleteRows: true,  viewAudit: true,  editDici: true,  manageConsultores: true,  viewSupervisorPanel: true  },
  consult:    { editSite: false, manageUsers: false, viewAll: true,  downloadDici: true,  deleteRows: false, viewAudit: true,  editDici: false, manageConsultores: false, viewSupervisorPanel: false },
  client:     { editSite: false, manageUsers: false, viewAll: false, downloadDici: false, deleteRows: false, viewAudit: false, editDici: true,  manageConsultores: false, viewSupervisorPanel: false },
  supervisor: { editSite: false, manageUsers: false, viewAll: true,  downloadDici: true,  deleteRows: false, viewAudit: true,  editDici: false, manageConsultores: true,  viewSupervisorPanel: true  },
};


const COLETAS_INIT = [
  { id: 'col1', clienteId: 'c1', cliente: 'Severino Ramilio', periodo: 'Jun 2025', mes: '06/2025', registros: 247, status: 'editing', enviadoEm: null, lancadoEm: null, consultor: 'Ana Paula', prazo: '30/06/2025' },
  { id: 'col2', clienteId: 'c2', cliente: 'NetPrime ISP', periodo: 'Jun 2025', mes: '06/2025', registros: 189, status: 'sent', enviadoEm: '14/06/2025', lancadoEm: null, consultor: 'Carlos', prazo: '30/06/2025' },
  { id: 'col3', clienteId: 'c3', cliente: 'FiberX Telecom', periodo: 'Jun 2025', mes: '06/2025', registros: 0, status: 'editing', enviadoEm: null, lancadoEm: null, consultor: 'Ana Paula', prazo: '30/06/2025' },
  { id: 'col4', clienteId: 'c4', cliente: 'VeloNet', periodo: 'Mai 2025', mes: '05/2025', registros: 178, status: 'launched', enviadoEm: '27/05/2025', lancadoEm: '28/05/2025', consultor: 'Carlos', prazo: '31/05/2025' },
  { id: 'col5', clienteId: 'c1', cliente: 'Severino Ramilio', periodo: 'Mai 2025', mes: '05/2025', registros: 231, status: 'launched', enviadoEm: '28/05/2025', lancadoEm: '28/05/2025', consultor: 'Ana Paula', prazo: '31/05/2025' },
];

const DICI_INIT = [
  { id: 'r1', cnpj: '08.640.151/0001-16', servico: 'SCM', mesRef: '06/2025', receitaBruta: '48320.00', acessos: '1240', uf: 'SP', ok: true },
  { id: 'r2', cnpj: '08.640.151/0001-16', servico: 'SCM', mesRef: '06/2025', receitaBruta: '12100.00', acessos: '380', uf: 'MG', ok: true },
  { id: 'r3', cnpj: '08.640.151/0001-16', servico: 'SMP', mesRef: '06/2025', receitaBruta: '', acessos: '92', uf: 'SP', ok: false },
  { id: 'r4', cnpj: '08.640.151/0001-16', servico: 'SCM', mesRef: '06/2025', receitaBruta: '7450.00', acessos: '210', uf: 'RJ', ok: true },
  { id: 'r5', cnpj: '08.640.151/0001-16', servico: 'SCM', mesRef: '06/2025', receitaBruta: '22890.00', acessos: '', uf: 'SP', ok: false },
  { id: 'r6', cnpj: '08.640.151/0001-16', servico: 'STFC', mesRef: '06/2025', receitaBruta: '4200.00', acessos: '88', uf: 'SP', ok: true },
];

const STATUS_MAP = {
  editing: { label: 'Em edição', color: 'orange' },
  sent: { label: 'Aguard. lançamento', color: 'blue' },
  launched: { label: 'Lançado Anatel', color: 'green' },
  overdue: { label: 'Atrasada', color: 'red' },
};

const CONSULTORES_SCM = [
  { id: 'lucas', nome: 'Lucas', email: 'lucas@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
  { id: 'carlos', nome: 'Carlos', email: 'carlos@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
  { id: 'caua', nome: 'Cauã', email: 'caua@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
  { id: 'joao', nome: 'João', email: 'joao@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
  { id: 'noemi', nome: 'Noemi', email: 'noemi@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
  { id: 'cleyton', nome: 'Cleyton', email: 'cleyton@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
  { id: 'barbara', nome: 'Bárbara', email: 'barbara@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
  { id: 'eduardo', nome: 'Eduardo', email: 'eduardo@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
  { id: 'erick', nome: 'Erick', email: 'erick@scm.com', role: 'consult', ativo: true, ultimoLogin: 'Ainda não acessou' },
];

const CONTAS_INICIAIS = [
  { id: 'admin-1', nome: 'Administrador', email: 'admin@scm.com', role: 'admin', ativo: true, ultimoLogin: 'Usuário inicial' },
  ...CONSULTORES_SCM,
];
const PLATAFORMAS_COLETA = [
  {
    id: 'ixc',
    nome: 'IXC Soft',
    descricao: 'Integração futura para importar clientes, planos, velocidades e acessos.',
    status: 'Em planejamento',
  },
  {
    id: 'hubsoft',
    nome: 'HubSoft',
    descricao: 'Estrutura preparada para buscar dados da empresa por ID/API futuramente.',
    status: 'Em planejamento',
  },
  {
    id: 'mk',
    nome: 'MK Solutions',
    descricao: 'Base reservada para conversão automática dos dados em planilha de coleta.',
    status: 'Em planejamento',
  },
];



/* ==============================
   AUTH CONTEXT
   ============================== */
const AuthCtx = createContext(null);

function gerarIniciais(nome = '') {
  return nome
    .split(' ')
    .filter(Boolean)
    .map(p => p[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

// Galeria de personagens para o avatar (consultor/supervisor). Estilo simples, sem upload.
const AVATARES = [
  '😎', '🧑‍💻', '👩‍💻', '🦸', '🦹', '🥷', '🤖', '👽',
  '🦉', '🦊', '🐱', '🐶', '🐼', '🦁', '🐯', '🦅',
  '🌟', '🚀', '⚡', '🎧', '🛡️', '🧠', '🐲', '🦄',
];

function normalizarUsuario(usuario) {
  if (!usuario) return null;

  return {
    id: usuario.id,
    name: usuario.nome || usuario.name,
    nome: usuario.nome || usuario.name,
    email: usuario.email,
    role: usuario.role,
    initials: usuario.initials || gerarIniciais(usuario.nome || usuario.name || usuario.email),
    avatar: usuario.avatar || null,
    cnpj: usuario.cnpj || null,
  };
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const carregar = async () => {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();

        if (cancelled) return;

        if (authError || !authData.user) {
          // Sessão inválida/expirada (ex.: "Invalid Refresh Token: Refresh Token Not Found").
          // Limpa o token quebrado do localStorage para parar o loop de auto-refresh.
          const msg = String(authError?.message || '').toLowerCase();
          if (
            authError &&
            (msg.includes('refresh token') || msg.includes('jwt') || authError.status === 400)
          ) {
            try { await supabase.auth.signOut({ scope: 'local' }); } catch { /* ignore */ }
          }
          setUser(null);
          return;
        }

        let { data: usuario, error: usuarioError } = await supabase
          .from('usuarios')
          .select('*')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (cancelled) return;

        // Fallback por email: cobre o caso (a corrigir no schema) em que auth.users.id != usuarios.id.
        if (!usuario) {
          const resultadoEmail = await supabase
            .from('usuarios')
            .select('*')
            .eq('email', authData.user.email)
            .maybeSingle();

          if (cancelled) return;

          usuario = resultadoEmail.data;
          usuarioError = resultadoEmail.error;
          if (usuario) {
            console.warn('Usuário localizado por email — id de auth.users diverge de usuarios.id. Corrigir no schema.');
          }
        }

        if (usuarioError || !usuario) {
          console.error('Usuário não encontrado na tabela usuarios:', usuarioError);
          setUser(null);
          return;
        }

        if (usuario.ativo === false) {
          console.error('Usuário inativo.');
          setUser(null);
          return;
        }

        setUser(normalizarUsuario(usuario));
      } catch (error) {
        if (cancelled) return;
        console.error('Erro ao carregar usuário logado:', error);
        setUser(null);
      } finally {
        if (!cancelled) setLoadingAuth(false);
      }
    };

    carregar();

    // IMPORTANTE: não chamar funções de auth do Supabase (getUser/getSession)
    // diretamente aqui dentro — isso causa deadlock do lock interno do GoTrue e
    // o login fica "girando" para sempre. Adiamos com setTimeout(0) para rodar
    // fora do callback, já com o lock liberado.
    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      if (cancelled) return;
      setTimeout(() => {
        if (!cancelled) carregar();
      }, 0);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (email, senha) => {
    const emailLimpo = email.trim();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailLimpo,
      password: senha,
    });

    if (error) {
      throw new Error(error.message || 'E-mail ou senha inválidos.');
    }

    let { data: usuario, error: usuarioError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('id', data.user.id)
      .maybeSingle();

    if (!usuario) {
      const resultadoEmail = await supabase
        .from('usuarios')
        .select('*')
        .eq('email', data.user.email)
        .maybeSingle();

      usuario = resultadoEmail.data;
      usuarioError = resultadoEmail.error;
    }

    if (usuarioError || !usuario) {
      throw new Error('Usuário autenticado, mas não cadastrado na tabela usuarios.');
    }

    if (usuario.ativo === false) {
      throw new Error('Esta conta está inativa. Entre em contato com o administrador.');
    }

    const usuarioNormalizado = normalizarUsuario(usuario);

    setUser(usuarioNormalizado);

    return usuarioNormalizado;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const atualizarAvatar = useCallback(async (avatar) => {
    const { error } = await supabase.rpc('fn_atualizar_meu_avatar', { p_avatar: avatar });
    if (error) throw error;
    setUser(prev => (prev ? { ...prev, avatar } : prev));
  }, []);

  const can = useCallback((p) => {
    return user ? (PERMISSIONS[user.role]?.[p] ?? false) : false;
  }, [user]);

  return (
    <AuthCtx.Provider
      value={{
        user,
        login,
        logout,
        atualizarAvatar,
        can,
        loadingAuth,
        isAdmin: user?.role === 'admin',
        isConsult: user?.role === 'consult',
        isClient: user?.role === 'client',
        isSupervisor: user?.role === 'supervisor',
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
const useAuth = () => useContext(AuthCtx);

/* ==============================
   MOBILE CONTEXT
   ============================== */
const MobileCtx = React.createContext(false);

function MobileProvider({ children }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);
  return <MobileCtx.Provider value={isMobile}>{children}</MobileCtx.Provider>;
}

const useMobile = () => useContext(MobileCtx);

/* ==============================
   UI PRIMITIVES
   ============================== */
const PILL_C = {
  green: { bg: '#EAF7EE', c: '#1E7E34' }, orange: { bg: '#FFF4EC', c: '#B04D00' },
  blue: { bg: '#E6F3FF', c: '#0F6FA8' }, gray: { bg: '#F5F4F0', c: '#706D68' }, red: { bg: '#FFF0F0', c: '#C0392B' }
};

function Pill({ label, color = 'gray', size = 'sm' }) {
  const s = PILL_C[color] || PILL_C.gray;
  return <span style={{
    display: 'inline-flex', alignItems: 'center',
    padding: size === 'sm' ? '3px 9px' : '5px 13px',
    borderRadius: 'var(--r-pill)',
    fontSize: size === 'sm' ? '11px' : '12px',
    fontWeight: 600, letterSpacing: '.01em',
    background: s.bg, color: s.c,
    border: `1px solid ${s.c}22`,
    whiteSpace: 'nowrap', lineHeight: 1.3,
  }}>
    {label}
  </span>;
}

function Btn({ children, variant = 'outline', size = 'md', onClick, disabled, type = 'button', style: st = {} }) {
  const vs = {
    outline: { background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' },
    primary: { background: 'linear-gradient(180deg,var(--orange-l),var(--orange))', color: '#fff', border: '1px solid var(--orange-d)' },
    dark: { background: 'var(--admin-bg)', color: '#fff', border: '1px solid var(--admin-bg)' },
    gray: { background: 'var(--consult-bg)', color: '#fff', border: '1px solid var(--consult-bg)' },
    danger: { background: 'var(--red-pale)', color: 'var(--red)', border: '1px solid #F1C0BC' },
    ghost: { background: 'transparent', color: 'var(--muted)', border: '1px solid transparent' },
  };
  const v = vs[variant] || vs.outline;
  const pad = size === 'sm' ? '6px 13px' : '9px 18px';
  const cls = 'scm-btn' + (variant === 'primary' ? ' scm-btn-primary' : '');
  return <button type={type} disabled={disabled} onClick={onClick} className={cls} style={{
    padding: pad, borderRadius: 'var(--r-sm)',
    fontSize: '12px', fontWeight: 600, lineHeight: 1.2,
    ...v,
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    ...st,
  }}>
    {children}
  </button>;
}

function Card({ children, style: st = {}, interactive = false }) {
  const cls = 'scm-card' + (interactive ? ' scm-card-lift' : '');
  return <div className={cls} style={{ marginBottom: '14px', ...st }}>{children}</div>;
}

function CardHead({ title, action }) {
  const isMobile = useMobile();
  return <div style={{
    padding: '13px 18px',
    borderBottom: '1px solid var(--border)',
    background: 'linear-gradient(180deg,rgba(250,250,247,.6),transparent)',
    display: 'flex',
    alignItems: isMobile ? 'flex-start' : 'center',
    justifyContent: 'space-between',
    flexDirection: isMobile ? 'column' : 'row',
    gap: isMobile ? '8px' : undefined,
  }}>
    <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '.01em' }}>{title}</span>
    {action}
  </div>;
}

function StatCard({ value, label, accent = 'orange' }) {
  const isMobile = useMobile();
  const ac = { orange: 'var(--orange)', black: 'var(--admin-bg)', gray: 'var(--consult-bg)', green: 'var(--green)', blue: 'var(--blue)' };
  const accentColor = ac[accent] || ac.orange;
  return <div className="scm-card scm-stat" style={{
    borderTop: `3px solid ${accentColor}`,
    borderRadius: 'var(--r-md)',
    padding: '16px 18px',
    marginBottom: 0,
    minWidth: isMobile ? '160px' : undefined,
    flexShrink: isMobile ? 0 : undefined,
    scrollSnapAlign: isMobile ? 'start' : undefined,
  }}>
    <div style={{
      fontSize: '24px', fontWeight: 600, fontFamily: 'var(--mono)',
      color: 'var(--text)', lineHeight: 1.1, letterSpacing: '-.01em',
    }}>{value}</div>
    <div style={{
      fontSize: '11px', color: 'var(--muted)', marginTop: '5px',
      textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 500,
    }}>{label}</div>
  </div>;
}

function Tbl({ headers, children }) {
  return <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
      <thead><tr>{headers.map((h, i) => <th key={i} style={{
        padding: '10px 14px', textAlign: 'left',
        fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.07em',
        color: 'var(--muted)', fontWeight: 600,
        borderBottom: '1px solid var(--border)',
        background: '#FAFAF7',
        whiteSpace: 'nowrap',
        position: 'sticky', top: 0, zIndex: 1,
      }}>{h}</th>)}</tr></thead>
      <tbody>{children}</tbody>
    </table>
  </div>;
}

function TR({ children, onClick }) {
  return <tr className="scm-tr" onClick={onClick}
    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--card-hover)'; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
    style={{ cursor: onClick ? 'pointer' : 'default' }}>{children}</tr>;
}

function TD({ children, mono, style: st = {} }) {
  return <td style={{
    padding: '10px 14px',
    borderBottom: '1px solid #F2F0EA',
    verticalAlign: 'middle',
    fontFamily: mono ? 'var(--mono)' : undefined,
    fontSize: mono ? '12px' : undefined,
    color: 'var(--text)',
    ...st,
  }}>{children}</td>;
}

function ActBtn({ children, variant = 'view', onClick, title, disabled }) {
  const vs = {
    view: { bg: '#EEF1FF', c: '#3B1FA8' },
    edit: { bg: 'var(--orange-pale)', c: 'var(--orange-d)' },
    del: { bg: 'var(--red-pale)', c: 'var(--red)' },
    dl: { bg: 'var(--blue-pale)', c: 'var(--blue)' },
  };
  const v = vs[variant] || vs.view;
  return <button title={title} disabled={disabled} onClick={onClick} className="scm-actbtn" style={{
    width: 30, height: 30,
    borderRadius: 'var(--r-sm)',
    border: '1px solid transparent',
    cursor: disabled ? 'default' : 'pointer',
    fontSize: '12px',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    marginRight: '3px',
    background: disabled ? '#F5F4F0' : v.bg,
    color: disabled ? 'var(--faint)' : v.c,
    opacity: disabled ? 0.5 : 1,
  }}>
    {children}
  </button>;
}

function Banner({ role, icon, title, sub }) {
  const s = {
    admin: { bg: 'linear-gradient(135deg,#F3F2F6,#EEEEF2)', b: '#D8D5E0', ic: 'var(--admin-bg)', tc: '#4A4870' },
    consult: { bg: 'linear-gradient(135deg,#F0F0F2,#EBEBED)', b: '#D6D6D9', ic: 'var(--consult-bg)', tc: '#555' },
    client: { bg: 'linear-gradient(135deg,#FFF8F0,#FFF0E1)', b: '#F5C9A0', ic: 'var(--orange)', tc: 'var(--orange-d)' },
  }[role] || {};
  return <div style={{
    background: s.bg, border: `1px solid ${s.b}`,
    borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-xs)',
    padding: '14px 16px',
    display: 'flex', alignItems: 'center', gap: '13px',
    marginBottom: '15px',
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: 'var(--r-md)', background: s.ic,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '16px', color: '#fff', flexShrink: 0,
      boxShadow: '0 4px 10px rgba(0,0,0,.10)',
    }}>{icon}</div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)' }}>{title}</div>
      <div style={{ fontSize: '12px', color: s.tc, marginTop: '2px' }}>{sub}</div>
    </div>
  </div>;
}

function Empty({ msg = 'Em implementação', sub = 'Em breve', icon }) {
  return <div className="scm-card scm-fade-in" style={{
    borderStyle: 'dashed', borderColor: 'var(--border-s)',
    padding: '56px 28px', textAlign: 'center', marginBottom: 0,
  }}>
    <div style={{
      width: 56, height: 56, margin: '0 auto 14px',
      borderRadius: '50%',
      background: 'linear-gradient(135deg,var(--orange-pale),#FFFAF3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '22px', color: 'var(--orange)',
      boxShadow: 'inset 0 0 0 1px rgba(217,95,0,.18)',
    }}>{icon || '◈'}</div>
    <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px', color: 'var(--text)' }}>{msg}</div>
    <div style={{ fontSize: '12px', color: 'var(--muted)' }}>{sub}</div>
  </div>;
}

function Toggle({ on, onChange, label }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange?.(!on)}
      style={{
        width: 38, height: 22, borderRadius: 'var(--r-pill)', cursor: 'pointer',
        position: 'relative', flexShrink: 0,
        background: on ? 'var(--orange)' : '#D6D3CC',
        boxShadow: on ? '0 0 0 1px var(--orange-d),inset 0 1px 2px rgba(0,0,0,.05)' : 'inset 0 1px 2px rgba(0,0,0,.1)',
        transition: 'background var(--t-base),box-shadow var(--t-base)',
        border: 'none', padding: 0,
      }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 18 : 2, width: 18, height: 18,
        borderRadius: '50%', background: '#fff',
        transition: 'left var(--t-base)',
        boxShadow: '0 1px 3px rgba(0,0,0,.25)',
      }} />
    </button>
    {label && <span style={{ fontSize: '12px', color: 'var(--muted)' }}>{label}</span>}
  </div>;
}

/* ==============================
   FEEDBACK — Cliente ↔ Admin
   ============================== */
const FEEDBACK_CATEGORIAS = [
  { v: 'sugestao', l: 'Sugestão de melhoria', i: '💡', cor: 'blue' },
  { v: 'duvida',   l: 'Dúvida',               i: '❓', cor: 'orange' },
  { v: 'problema', l: 'Problema / Bug',       i: '🐞', cor: 'red' },
  { v: 'outro',    l: 'Elogio / Outro',       i: '💬', cor: 'green' },
];
const FEEDBACK_CATEGORIAS_MAP = Object.fromEntries(FEEDBACK_CATEGORIAS.map(c => [c.v, c]));
const FEEDBACK_STATUS_MAP = {
  pendente:   { l: 'Pendente',   cor: 'orange' },
  visto:      { l: 'Visto',      cor: 'blue' },
  respondido: { l: 'Respondido', cor: 'green' },
};

function formatarDataRelativaCurta(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  if (diff < 604800) return `há ${Math.floor(diff / 86400)} dia(s)`;
  return d.toLocaleDateString('pt-BR');
}

function formatarDataHora(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function FloatingFeedbackButton() {
  const { user, isClient } = useAuth();
  const [open, setOpen] = useState(false);
  const [novasRespostas, setNovasRespostas] = useState(0);

  const carregarContador = useCallback(async () => {
    if (!user?.id) return;
    const chave = `feedback_ultima_leitura_${user.id}`;
    const ultimaLeitura = localStorage.getItem(chave) || '1970-01-01T00:00:00Z';
    const { count } = await supabase
      .from('feedbacks')
      .select('id', { count: 'exact', head: true })
      .eq('cliente_id', user.id)
      .eq('status', 'respondido')
      .gt('respondido_em', ultimaLeitura);
    setNovasRespostas(count || 0);
  }, [user?.id]);

  useEffect(() => {
    if (!isClient || !user?.id) return;
    carregarContador();
    const ch = supabase
      .channel('feedback-client-' + user.id)
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'feedbacks', filter: `cliente_id=eq.${user.id}` },
        () => carregarContador()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isClient, user?.id, carregarContador]);

  const handleAbrir = () => {
    setOpen(true);
    if (user?.id) {
      localStorage.setItem(`feedback_ultima_leitura_${user.id}`, new Date().toISOString());
      setNovasRespostas(0);
    }
  };

  if (!isClient) return null;

  return <>
    <button
      onClick={handleAbrir}
      aria-label="Enviar sugestão ou dúvida"
      title="Sugestões, dúvidas e feedback"
      style={{
        position: 'fixed',
        bottom: 'calc(24px + var(--safe-bottom, 0px))',
        right: 24,
        width: 56, height: 56,
        borderRadius: '50%',
        background: 'linear-gradient(180deg,var(--orange-l),var(--orange))',
        color: '#fff',
        border: '1px solid var(--orange-d)',
        cursor: 'pointer',
        boxShadow: '0 10px 24px rgba(0,0,0,.22)',
        fontSize: 22,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
        transition: 'transform var(--t-base, .18s)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.06)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
    >
      <span aria-hidden="true">💬</span>
      {novasRespostas > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          minWidth: 22, height: 22, padding: '0 6px',
          background: '#C0392B', color: '#fff',
          borderRadius: 'var(--r-pill)',
          fontSize: 11, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          border: '2px solid #fff',
        }}>{novasRespostas}</span>
      )}
    </button>
    {open && <FeedbackModal onClose={() => setOpen(false)} />}
  </>;
}

function FeedbackModal({ onClose }) {
  const { user } = useAuth();
  const isMobile = useMobile();
  const [aba, setAba] = useState('novo');

  const [categoria, setCategoria] = useState('sugestao');
  const [assunto, setAssunto] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  const [historico, setHistorico] = useState([]);
  const [carregandoHist, setCarregandoHist] = useState(false);
  const [expandido, setExpandido] = useState(null);

  const carregarHistorico = useCallback(async () => {
    if (!user?.id) return;
    setCarregandoHist(true);
    const { data, error } = await supabase
      .from('feedbacks')
      .select('*')
      .eq('cliente_id', user.id)
      .order('created_at', { ascending: false });
    if (!error) setHistorico(data || []);
    setCarregandoHist(false);
  }, [user?.id]);

  useEffect(() => {
    if (aba === 'historico') carregarHistorico();
  }, [aba, carregarHistorico]);

  const handleEnviar = async () => {
    try {
      setErro('');
      const a = assunto.trim();
      const m = mensagem.trim();
      if (a.length < 4) { setErro('Informe um assunto com pelo menos 4 caracteres.'); return; }
      if (m.length < 10) { setErro('Descreva sua mensagem com pelo menos 10 caracteres.'); return; }
      setEnviando(true);
      const { error } = await supabase.from('feedbacks').insert([{
        cliente_id:      user.id,
        cliente_nome:    user.name,
        cliente_empresa: user.name,
        cliente_cnpj:    user.cnpj || null,
        categoria,
        assunto:         a,
        mensagem:        m,
      }]);
      if (error) throw error;
      alert('✓ Mensagem enviada!\n\nA equipe SCM já foi notificada e responderá em breve.');
      setAssunto('');
      setMensagem('');
      setCategoria('sugestao');
      setAba('historico');
    } catch (e) {
      setErro(e?.message || 'Não foi possível enviar agora. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  return <div
    onClick={onClose}
    style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,.5)',
      zIndex: 1001,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: isMobile ? 0 : 20,
    }}>
    <div
      onClick={(e) => e.stopPropagation()}
      className="scm-fade-in"
      style={{
        width: '100%',
        maxWidth: 640,
        maxHeight: isMobile ? '100dvh' : '88vh',
        height: isMobile ? '100dvh' : 'auto',
        display: 'flex', flexDirection: 'column',
        background: 'var(--card)',
        borderRadius: isMobile ? 0 : 'var(--r-lg)',
        overflow: 'hidden',
        boxShadow: '0 30px 60px rgba(0,0,0,.35)',
        border: '1px solid var(--border)',
      }}>
      {/* Header */}
      <div style={{
        padding: '14px 18px',
        borderBottom: '1px solid var(--border)',
        background: 'linear-gradient(180deg,var(--orange-pale),transparent)',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 'var(--r-md)',
          background: 'linear-gradient(180deg,var(--orange-l),var(--orange))',
          color: '#fff', fontSize: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>💬</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Fale com a equipe SCM</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Envie sugestões, dúvidas, reporte problemas ou deixe um elogio
          </div>
        </div>
        <button onClick={onClose} aria-label="Fechar" style={{
          width: 36, height: 36, borderRadius: 'var(--r-sm)',
          background: 'transparent', border: '1px solid var(--border)',
          cursor: 'pointer', fontSize: 16, color: 'var(--muted)',
          flexShrink: 0,
        }}>✕</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: '#FAFAF7' }}>
        {[
          { v: 'novo', l: 'Nova mensagem' },
          { v: 'historico', l: 'Minhas mensagens' },
        ].map(t => (
          <button key={t.v} onClick={() => setAba(t.v)} style={{
            flex: 1, padding: '12px 8px',
            background: 'transparent', border: 'none',
            borderBottom: aba === t.v ? '2px solid var(--orange)' : '2px solid transparent',
            color: aba === t.v ? 'var(--orange-d)' : 'var(--muted)',
            fontWeight: aba === t.v ? 600 : 500,
            fontSize: 12, cursor: 'pointer',
          }}>{t.l}</button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
        {aba === 'novo' && (
          <div>
            <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Categoria</label>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)',
              gap: 8, marginTop: 6, marginBottom: 16,
            }}>
              {FEEDBACK_CATEGORIAS.map(c => {
                const selected = categoria === c.v;
                return <button key={c.v} type="button" onClick={() => setCategoria(c.v)} style={{
                  padding: '10px 6px',
                  borderRadius: 'var(--r-sm)',
                  border: selected ? '2px solid var(--orange)' : '1px solid var(--border)',
                  background: selected ? 'var(--orange-pale)' : 'var(--card)',
                  cursor: 'pointer',
                  fontSize: 11, fontWeight: 600,
                  color: selected ? 'var(--orange-d)' : 'var(--text)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  transition: 'background var(--t-fast), border-color var(--t-fast)',
                }}>
                  <span style={{ fontSize: 18 }}>{c.i}</span>
                  <span style={{ lineHeight: 1.2, textAlign: 'center' }}>{c.l}</span>
                </button>;
              })}
            </div>

            <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Assunto</label>
            <input
              type="text"
              className="scm-input"
              maxLength={120}
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              placeholder="Resumo em poucas palavras..."
              style={{ marginTop: 6, marginBottom: 16 }}
            />

            <label style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>Mensagem</label>
            <textarea
              className="scm-input"
              rows={6}
              value={mensagem}
              onChange={(e) => setMensagem(e.target.value)}
              placeholder="Descreva sua sugestão, dúvida ou problema com o máximo de detalhes possível..."
              style={{ marginTop: 6, resize: 'vertical', fontFamily: 'inherit' }}
            />

            {erro && (
              <div style={{
                marginTop: 12, padding: '10px 12px',
                borderRadius: 'var(--r-sm)',
                background: '#FFF0F0', color: 'var(--red)',
                fontSize: 12, border: '1px solid #F1C0BC',
              }}>{erro}</div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18, flexWrap: 'wrap' }}>
              <Btn onClick={onClose}>Cancelar</Btn>
              <Btn variant="primary" onClick={handleEnviar} disabled={enviando}>
                {enviando ? 'Enviando...' : 'Enviar mensagem'}
              </Btn>
            </div>
          </div>
        )}

        {aba === 'historico' && (
          <div>
            {carregandoHist && (
              <div style={{ textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 13 }}>
                Carregando...
              </div>
            )}
            {!carregandoHist && historico.length === 0 && (
              <Empty msg="Nenhuma mensagem enviada ainda" sub="Use a aba 'Nova mensagem' para iniciar uma conversa com a equipe SCM." icon="💬" />
            )}
            {!carregandoHist && historico.map(f => {
              const cat = FEEDBACK_CATEGORIAS_MAP[f.categoria] || { l: f.categoria, i: '•', cor: 'gray' };
              const st = FEEDBACK_STATUS_MAP[f.status] || { l: f.status, cor: 'gray' };
              const aberto = expandido === f.id;
              return <div key={f.id} style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                marginBottom: 10,
                background: 'var(--card)',
                overflow: 'hidden',
              }}>
                <button onClick={() => setExpandido(aberto ? null : f.id)} style={{
                  width: '100%', padding: '12px 14px',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                }}>
                  <span style={{ fontSize: 18 }} aria-hidden="true">{cat.i}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: 'var(--text)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{f.assunto}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {cat.l} • {formatarDataRelativaCurta(f.created_at)}
                    </div>
                  </div>
                  <Pill label={st.l} color={st.cor} />
                </button>
                {aberto && (
                  <div style={{ padding: '4px 14px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{
                      fontSize: 11, color: 'var(--muted)', marginTop: 10, marginBottom: 4,
                      textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600,
                    }}>Sua mensagem</div>
                    <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{f.mensagem}</div>
                    {f.admin_resposta && (
                      <div style={{
                        marginTop: 14, padding: 12,
                        background: '#EAF7EE', border: '1px solid #BBDDC4',
                        borderRadius: 'var(--r-sm)',
                      }}>
                        <div style={{
                          fontSize: 11, color: '#1E7E34', fontWeight: 600, marginBottom: 6,
                          textTransform: 'uppercase', letterSpacing: '.05em',
                        }}>
                          Resposta da equipe SCM{f.admin_nome ? ` — ${f.admin_nome}` : ''} • {formatarDataHora(f.respondido_em)}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{f.admin_resposta}</div>
                      </div>
                    )}
                  </div>
                )}
              </div>;
            })}
          </div>
        )}
      </div>
    </div>
  </div>;
}

function ViewFeedback() {
  const { user, isAdmin } = useAuth();
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroCategoria, setFiltroCategoria] = useState('todos');
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState(null);
  const [respondendoId, setRespondendoId] = useState(null);
  const [respostaTexto, setRespostaTexto] = useState('');
  const [enviandoResposta, setEnviandoResposta] = useState(false);

const carregar = useCallback(async () => {
  try {
    setCarregando(true);

    const { data, error } = await supabase
      .from('feedbacks')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    setLista(data || []);
  } catch (error) {
    console.error('Erro ao carregar feedbacks:', error);
  } finally {
    setCarregando(false);
  }
}, []);

  useEffect(() => {
    if (!isAdmin) return;
    carregar();
    const ch = supabase
      .channel('feedback-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, () => carregar())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [isAdmin, carregar]);

  if (!isAdmin) return <Empty msg="Acesso restrito" />;

  const filtrados = lista.filter(f => {
    if (filtroStatus !== 'todos' && f.status !== filtroStatus) return false;
    if (filtroCategoria !== 'todos' && f.categoria !== filtroCategoria) return false;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      const alvo = `${f.assunto || ''} ${f.cliente_empresa || ''} ${f.cliente_nome || ''} ${f.cliente_cnpj || ''} ${f.mensagem || ''}`.toLowerCase();
      if (!alvo.includes(q)) return false;
    }
    return true;
  });

  const total = lista.length;
  const pendentes = lista.filter(f => f.status === 'pendente').length;
  const respondidos = lista.filter(f => f.status === 'respondido').length;

  const marcarVisto = async (id) => {
    const { error } = await supabase.from('feedbacks').update({ status: 'visto' }).eq('id', id);
    if (error) { alert(error.message || 'Erro ao marcar como visto.'); return; }
    carregar();
  };

  const enviarResposta = async (f) => {
    if (respostaTexto.trim().length < 3) { alert('Digite uma resposta antes de enviar.'); return; }
    try {
      setEnviandoResposta(true);
      const { error } = await supabase.from('feedbacks').update({
        admin_resposta: respostaTexto.trim(),
        admin_id:       user.id,
        admin_nome:     user.name,
        respondido_em:  new Date().toISOString(),
        status:         'respondido',
      }).eq('id', f.id);
      if (error) throw error;
      setRespondendoId(null);
      setRespostaTexto('');
      await carregar();
    } catch (e) {
      alert(e?.message || 'Erro ao enviar resposta.');
    } finally {
      setEnviandoResposta(false);
    }
  };

  return <div className="scm-fade-in">
    {/* Stats */}
    <div style={{ display: 'flex', gap: 14, marginBottom: 16, overflowX: 'auto', paddingBottom: 4 }}>
      <StatCard value={total} label="Total recebidos" accent="black" />
      <StatCard value={pendentes} label="Pendentes" accent="orange" />
      <StatCard value={respondidos} label="Respondidos" accent="green" />
    </div>

    {/* Filtros */}
    <Card>
      <div style={{ padding: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          className="scm-input"
          placeholder="Buscar por empresa, CNPJ, assunto ou mensagem..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          style={{ flex: '1 1 220px', minWidth: 160 }}
        />
        <select className="scm-input" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} style={{ flex: '0 0 160px' }}>
          <option value="todos">Todos os status</option>
          <option value="pendente">Pendentes</option>
          <option value="visto">Vistos</option>
          <option value="respondido">Respondidos</option>
        </select>
        <select className="scm-input" value={filtroCategoria} onChange={(e) => setFiltroCategoria(e.target.value)} style={{ flex: '0 0 200px' }}>
          <option value="todos">Todas as categorias</option>
          {FEEDBACK_CATEGORIAS.map(c => <option key={c.v} value={c.v}>{c.i} {c.l}</option>)}
        </select>
      </div>
    </Card>

    {/* Lista */}
    {carregando && <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>Carregando feedbacks...</div>}
    {!carregando && filtrados.length === 0 && (
      <Empty msg="Nenhum feedback no filtro atual"
             sub={lista.length === 0 ? 'Quando clientes enviarem mensagens, elas aparecerão aqui.' : 'Tente ajustar os filtros acima.'}
             icon="💬" />
    )}
    {!carregando && filtrados.map(f => {
      const cat = FEEDBACK_CATEGORIAS_MAP[f.categoria] || { l: f.categoria, i: '•', cor: 'gray' };
      const st = FEEDBACK_STATUS_MAP[f.status] || { l: f.status, cor: 'gray' };
      const aberto = expandido === f.id;
      const respondendo = respondendoId === f.id;
      return <Card key={f.id}>
        <div style={{ padding: '14px 18px' }}>
          {/* Cabeçalho da empresa */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--admin-bg)' }}>
              {f.cliente_empresa || f.cliente_nome || '—'}
            </span>
            {f.cliente_cnpj && (
              <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                CNPJ {f.cliente_cnpj}
              </span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
              {formatarDataHora(f.created_at)} • {formatarDataRelativaCurta(f.created_at)}
            </span>
          </div>
          {/* Frase de resumo profissional */}
          <div style={{ fontSize: 14, color: 'var(--text)', marginBottom: 10, lineHeight: 1.4 }}>
            <strong>{f.cliente_empresa || f.cliente_nome || 'Cliente'}</strong> comentou sobre <strong>"{f.assunto}"</strong>
          </div>
          {/* Badges */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <Pill label={`${cat.i} ${cat.l}`} color={cat.cor} />
            <Pill label={st.l} color={st.cor} />
          </div>
          {/* Botões */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Btn size="sm" onClick={() => setExpandido(aberto ? null : f.id)}>
              {aberto ? 'Recolher' : 'Ver detalhes'}
            </Btn>
            {f.status === 'pendente' && (
              <Btn size="sm" onClick={() => marcarVisto(f.id)}>Marcar como visto</Btn>
            )}
            {!respondendo && (
              <Btn size="sm" variant="primary" onClick={() => {
                setRespondendoId(f.id);
                setRespostaTexto(f.admin_resposta || '');
                setExpandido(f.id);
              }}>
                {f.admin_resposta ? 'Editar resposta' : 'Responder'}
              </Btn>
            )}
          </div>

          {/* Expandido */}
          {aberto && (
            <div style={{
              marginTop: 14, padding: 14,
              background: '#FAFAF7', borderRadius: 'var(--r-sm)',
              border: '1px solid var(--border)',
            }}>
              <div style={{
                fontSize: 11, color: 'var(--muted)',
                textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600,
                marginBottom: 6,
              }}>Mensagem do cliente</div>
              <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{f.mensagem}</div>

              {f.admin_resposta && !respondendo && (
                <>
                  <div style={{
                    fontSize: 11, color: '#1E7E34',
                    textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600,
                    marginTop: 14, marginBottom: 6,
                  }}>
                    Resposta enviada{f.admin_nome ? ` por ${f.admin_nome}` : ''} • {formatarDataHora(f.respondido_em)}
                  </div>
                  <div style={{
                    fontSize: 13, whiteSpace: 'pre-wrap', lineHeight: 1.5,
                    padding: 10, background: '#EAF7EE',
                    borderRadius: 'var(--r-sm)', border: '1px solid #BBDDC4',
                  }}>{f.admin_resposta}</div>
                </>
              )}

              {respondendo && (
                <div style={{ marginTop: 14 }}>
                  <div style={{
                    fontSize: 11, color: 'var(--muted)',
                    textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600,
                    marginBottom: 6,
                  }}>Sua resposta</div>
                  <textarea
                    className="scm-input"
                    rows={5}
                    value={respostaTexto}
                    onChange={(e) => setRespostaTexto(e.target.value)}
                    placeholder="Escreva uma resposta clara e cordial para o cliente..."
                    style={{ resize: 'vertical', fontFamily: 'inherit' }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Btn size="sm" onClick={() => { setRespondendoId(null); setRespostaTexto(''); }}>Cancelar</Btn>
                    <Btn size="sm" variant="primary" onClick={() => enviarResposta(f)} disabled={enviandoResposta}>
                      {enviandoResposta ? 'Enviando...' : 'Enviar resposta'}
                    </Btn>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Card>;
    })}
  </div>;
}

/* ==============================
   SIDEBAR
   ============================== */
const NAV = {
  admin: [
    { s: 'Principal' },
    { i: '◉', l: 'Painel', v: 'dashboard' },
    { i: '□', l: 'Comprovantes', v: 'docs' },
    { i: '▣', l: 'Documentos Gerais', v: 'documentos' },
    { i: '◈', l: 'Usuários', v: 'users' },

    { s: 'Tributos & Anuidades' },
    { i: '📡', l: 'Anuidade ANATEL', v: 'anuidades_anatel' },
    { i: '🏗️', l: 'Anuidade CREA/CFT', v: 'anuidades_crea_cft' },
    { i: '🎬', l: 'Anuidade ANCINE', v: 'anuidades_ancine' },

    { s: 'Anatel' },
    { i: '◎', l: 'Vistoria Mensal', v: 'vistoria' },
    { i: '◇', l: 'Outorgas', v: 'outorgas' },
    { i: '△', l: 'RF / Licenciamento', v: 'rf' },

    { s: 'CREA/CFT' },
    { i: '▣', l: 'Registros CREA', v: 'crea' },
    { i: '◻', l: 'Resp. Técnicos', v: 'responsaveis' },

    { s: 'Administração' },
    { i: '💬', l: 'Feedback dos clientes', v: 'feedback' },
    { i: '✎', l: 'Editor do Site', v: 'editor' },
    { i: '⊞', l: 'Permissões', v: 'perms' },
    { i: '⚙', l: 'Configurações', v: 'config' },
  ],
  consult: [
{ s: 'Principal' },
{ i: '◉', l: 'Painel', v: 'dashboard' },
{ i: '≡', l: 'Conversor DICI', v: 'dici', b: '' },
{ i: '▤', l: 'Planilhas dos clientes', v: 'planilhas' },
{ i: '💳', l: 'Guias FUST/FUNTTEL', v: 'fust_funttel' },
{ i: '□', l: 'Comprovante DICI', v: 'docs' },
{ i: '▣', l: 'Documentos Gerais', v: 'documentos' },

{ s: 'Tributos & Anuidades' },
    { i: '📡', l: 'Anuidade ANATEL', v: 'anuidades_anatel' },
    { i: '🏗️', l: 'Anuidade CREA/CFT', v: 'anuidades_crea_cft' },
    { i: '🎬', l: 'Anuidade ANCINE', v: 'anuidades_ancine' },

    { s: 'Anatel' }, { i: '◎', l: 'Vistoria Mensal', v: 'vistoria' }, { i: '◇', l: 'Outorgas', v: 'x' }, { i: '△', l: 'RF / Licenciamento', v: 'x' },
    { s: 'CREA/CFT' }, { i: '▣', l: 'Registros CREA', v: 'x' }, { i: '◻', l: 'Resp. Técnicos', v: 'x' },

  ],
  client: [
    { s: 'Meu Painel' },
    { i: '◉', l: 'Painel', v: 'dashboard' },
  //    { i: '🔌', l: 'Integrações', v: 'integracoes' },
{ i: '≡', l: 'Conversor DICI', v: 'dici', b: '' },
{ i: '💳', l: 'Guias FUST/FUNTTEL', v: 'fust_funttel' },
{ i: '▤', l: 'Planilhas', v: 'planilhas' },
{ i: '□', l: 'Comprovantes', v: 'docs' },
{ i: '▣', l: 'Documentos Gerais', v: 'documentos' },



    { s: 'Anuidades' },
    { i: '📡', l: 'Anuidade ANATEL', v: 'anuidades_anatel' },
    { i: '🏗️', l: 'Anuidade CREA/CFT', v: 'anuidades_crea_cft' },
    { i: '🎬', l: 'Anuidade ANCINE', v: 'anuidades_ancine' },
  ],
  supervisor: [
    { s: 'Supervisão' },
    { i: '📊', l: 'Painel Supervisor',     v: 'supervisor_dashboard' },
    { i: '🗒️', l: 'Agenda do Dia',          v: 'supervisor_agenda' },
    { i: '▤', l: 'Coletas por Consultor',  v: 'supervisor_coletas' },
    { i: '🏢', l: 'Empresas e Consultores', v: 'supervisor_empresas' },
    { i: '💳', l: 'Guias FUST/FUNTTEL',     v: 'fust_funttel' },
    { i: '□', l: 'Comprovantes DICI',       v: 'docs' },
    { i: '▣', l: 'Documentos Gerais',       v: 'documentos' },
  ],
};

const SB_BG = {
  admin: 'linear-gradient(160deg,#111010,#18171A 60%,#28272B)',
  consult: 'linear-gradient(160deg,#363638,#4A4A4E 60%,#5A5A5F)',
  client: 'linear-gradient(160deg,#B04D00,#D95F00 60%,#E07020)',
  supervisor: 'linear-gradient(160deg, #111315, #23282F 60%, #3B4652)',
};

const FRASES_DO_DIA = [
  'Com trabalho em equipe, café e um pouco de coragem, até a segunda-feira começa a cooperar. ☕🚀',
  'Respira, toma um café e lembra: até boleto tem vencimento, mas você não. ☕',
  'Uma coleta por vez e, quando assustar, o mês fechou. 🚀',
  'Consultor bom não surta: apenas abre outra aba e segue firme. 🧘',
  'Hoje o sistema pode até pensar, mas quem resolve é você. 💪',
  'A meta do dia é simples: menos pendência, mais paz interior. ✨',
  'Se a planilha veio bagunçada, é porque ela ainda não conheceu seu talento. 😄',
  'Não é só uma coleta. É mais uma vitória regulatória disfarçada. 🏆',
  'Hoje a missão é transformar caos em protocolo. 📁',
  'Um lobo em silêncio impõe mais respeito que um cachorro latindo. ☕',
  'O boleto pode vencer, mas sua paciência precisa renovar automaticamente. 😅',
  'Você não está atrasado, está em processamento. ⚙️',
  'Toda pendência resolvida é um carinho no dashboard. 🧡',
  'Se der erro, respira. Se persistir, printa. Se resolver, comemora. 📸',
  'Hoje é um ótimo dia para deixar o status como finalizado. ✅',
  'Trabalhe com calma: até o loading uma hora termina. ⏳',
  'A planilha pode até vir torta, mas daqui ela sai alinhada. 📐',
  'Você é tipo API boa: entrega resultado mesmo sob pressão. 🔌',
  'Que seu dia tenha menos bugs e mais comprovantes anexados. 📎',
  'Se tudo parecer urgente, comece pelo que está piscando mais forte. 🔥',
  'Hoje o regulatório que lute, porque você veio preparado. 😎',
  'Uma aba aberta é trabalho. Dez abas abertas é consultoria avançada. 🧠',
  'O segredo é parecer calmo enquanto o Excel tenta te testar. 📗',
  'Você não procrastina, só aguarda o melhor momento operacional. 🤭',
  'Pendência pequena resolvida cedo evita reunião grande depois. 📝',
  'Que o dia seja leve, os clientes respondam e os arquivos abram. 🙏',
  'Hoje o objetivo é simples: clicar, resolver e não se estressar. 🖱️',
  'Se aparecer erro, lembre: até sistema bom tem seus dias de novela. 🎭',
  'Quando acharem que estão tendo um dia ruim, lembrem-se: vocês trabalham com o Cauã 📄',
  'O mundo é dos organizados, mas o portal é dos persistentes. 🌎',
  'Hoje você está oficialmente autorizado a vencer o caos com elegância. ✨',
];

function obterNumeroDoDiaNoAno() {
  const hoje = new Date();
  const inicioAno = new Date(hoje.getFullYear(), 0, 0);
  const diff = hoje - inicioAno;
  const umDia = 1000 * 60 * 60 * 24;

  return Math.floor(diff / umDia);
}

function obterFraseDoDia(user) {
  const diaAno = obterNumeroDoDiaNoAno();

  // Pequeno ajuste para cada pessoa não cair sempre na mesma frase,
  // mas ainda mantendo a mesma frase durante o dia inteiro.
  const baseUsuario = String(user?.email || user?.name || '')
    .split('')
    .reduce((total, letra) => total + letra.charCodeAt(0), 0);

  const indice = (diaAno + baseUsuario) % FRASES_DO_DIA.length;

  return FRASES_DO_DIA[indice];
}

function AvatarPicker({ atual, onSelecionar, onFechar }) {
  return <div className="scm-fade-in" style={{
    margin: '0 10px 8px',
    padding: '10px 12px',
    borderRadius: 'var(--r-md)',
    background: 'rgba(255,255,255,.97)',
    color: '#242424',
    border: '1px solid rgba(255,255,255,.45)',
    boxShadow: '0 12px 28px rgba(0,0,0,.24)',
  }}>
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '8px', marginBottom: '8px',
    }}>
      <div style={{
        fontSize: '10px', fontWeight: 800, color: 'var(--orange)',
        textTransform: 'uppercase', letterSpacing: '.08em',
      }}>Escolha seu avatar</div>
      <button type="button" onClick={onFechar} style={{
        width: 22, height: 22, borderRadius: '8px',
        border: '1px solid rgba(0,0,0,.08)', background: '#fff',
        color: 'var(--muted)', cursor: 'pointer', fontSize: '11px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>✕</button>
    </div>

    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '5px',
    }}>
      {AVATARES.map((emoji) => {
        const selecionado = atual === emoji;
        return <button
          key={emoji}
          type="button"
          onClick={() => onSelecionar(emoji)}
          title={selecionado ? 'Avatar atual' : 'Usar este avatar'}
          style={{
            aspectRatio: '1 / 1', borderRadius: '9px', cursor: 'pointer',
            fontSize: '18px', lineHeight: 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: selecionado ? 'var(--orange-pale, #FFF0E1)' : '#F4F4F5',
            border: selecionado ? '2px solid var(--orange)' : '1px solid rgba(0,0,0,.08)',
          }}
        >{emoji}</button>;
      })}
    </div>

    <button type="button" onClick={() => onSelecionar(null)} style={{
      width: '100%', marginTop: '8px', padding: '7px',
      borderRadius: '9px', cursor: 'pointer',
      border: '1px dashed rgba(0,0,0,.18)', background: '#fff',
      color: 'var(--muted)', fontSize: '11px', fontWeight: 600,
      fontFamily: 'var(--font)',
    }}>Usar iniciais</button>
  </div>;
}

function Sidebar({ active, nav, isMobile, open, onClose }) {
  const { user, logout, atualizarAvatar } = useAuth();

  const [fraseAberta, setFraseAberta] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const podeEditarAvatar = user?.role === 'consult' || user?.role === 'supervisor';

const podeVerFraseDoDia =
  user?.role === 'consult' || user?.role === 'supervisor';

const fraseDoDia = React.useMemo(() => {
  return obterFraseDoDia(user);
}, [user?.email, user?.name, user?.role]);
  
const [notificacoes, setNotificacoes] = useState({
  feedback: 0,
  dici: 0,
  fustFunttel: 0,
  guiasFustFunttel: 0,
  supervisorColetas: 0,
  supervisorEmpresasSemConsultor: 0,
});

useEffect(() => {
  if (!user?.role) return;

  let cancelado = false;

  const carregar = async () => {
    const novasNotificacoes = {
      feedback: 0,
      dici: 0,
      fustFunttel: 0,
      guiasFustFunttel: 0,
      supervisorColetas: 0,
      supervisorEmpresasSemConsultor: 0,
    };

    if (user.role === 'admin') {
      const { count: feedbackCount } = await supabase
        .from('feedbacks')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pendente');

      novasNotificacoes.feedback = feedbackCount || 0;
    }

    if (user.role === 'admin' || user.role === 'consult') {
      const { count: diciCount } = await supabase
        .from('planilhas_coleta')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'recebido');

      const { count: fustCount } = await supabase
        .from('fust_funttel')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'enviado');

      novasNotificacoes.dici = diciCount || 0;
      novasNotificacoes.fustFunttel = fustCount || 0;
    }

    if (user.role === 'client') {
      const chaveLeitura = `guias_fust_funttel_ultima_leitura_${user.id}`;
      const ultimaLeitura = localStorage.getItem(chaveLeitura) || '1970-01-01T00:00:00Z';

      const { count: guiasCount } = await supabase
        .from('fust_funttel_boletos')
        .select('id', { count: 'exact', head: true })
        .eq('cnpj', normalizarCnpj(user?.cnpj))
        .gt('criado_em', ultimaLeitura);

      novasNotificacoes.guiasFustFunttel = guiasCount || 0;
    }

    if (user.role === 'supervisor') {
      const { count: coletasRecebidas } = await supabase
        .from('planilhas_coleta')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'recebido');

      const { count: empresasSemConsultor } = await supabase
        .from('clientes')
        .select('id', { count: 'exact', head: true })
        .or('consultor.is.null,consultor.eq.');

      let fustEnviado = 0;
      try {
        const { count } = await supabase
          .from('fust_funttel')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'enviado');
        fustEnviado = count || 0;
      } catch (_) { /* tabela pode não existir */ }

      novasNotificacoes.supervisorColetas = coletasRecebidas || 0;
      novasNotificacoes.supervisorEmpresasSemConsultor = empresasSemConsultor || 0;
      novasNotificacoes.fustFunttel = fustEnviado;
    }

    if (!cancelado) {
      setNotificacoes(novasNotificacoes);
    }
  };

  carregar();

  const ch = supabase
    .channel('notificacoes-sidebar')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, () => carregar())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'planilhas_coleta' }, () => carregar())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fust_funttel' }, () => carregar())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'fust_funttel_boletos' }, () => carregar())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => carregar())
    .subscribe();

  return () => {
    cancelado = true;
    supabase.removeChannel(ch);
  };
}, [user?.role, user?.id, user?.cnpj]);

  if (!user) return null;
  const items = NAV[user.role] || [];
  const roleLabel = { admin: 'Administrador', consult: 'Consultor', client: 'Cliente', supervisor: 'Supervisor' }[user.role];
  const badge = { admin: 'ADMIN', consult: 'SCM', client: 'CLIENTE', supervisor: 'SUPERVISOR' }[user.role];

  return <aside
    data-mobile={isMobile ? 'true' : undefined}
    style={{
      width: 'var(--sw)', background: SB_BG[user.role],
      display: 'flex', flexDirection: 'column', flexShrink: 0, overflow: 'hidden',
      position: isMobile ? 'fixed' : 'relative',
      top: isMobile ? 0 : undefined, left: isMobile ? 0 : undefined,
      bottom: isMobile ? 0 : undefined, zIndex: isMobile ? 50 : undefined,
      transform: isMobile ? (open ? 'translateX(0)' : 'translateX(-100%)') : undefined,
      transition: isMobile ? 'transform 0.25s ease-out' : undefined,
      paddingLeft: isMobile ? 'var(--safe-left)' : undefined,
    }}>
    {/* Glow decorativo */}
    <div style={{
      position: 'absolute', width: 220, height: 220, borderRadius: '50%',
      background: 'radial-gradient(circle,rgba(255,255,255,.08),transparent 70%)',
      top: -90, right: -80, pointerEvents: 'none'
    }} />
    <div style={{
      position: 'absolute', width: 160, height: 160, borderRadius: '50%',
      background: 'radial-gradient(circle,rgba(255,255,255,.04),transparent 70%)',
      bottom: 90, left: -60, pointerEvents: 'none'
    }} />

    {/* Brand */}
    <div style={{
      padding: '16px 16px 14px',
      borderBottom: '1px solid rgba(255,255,255,.10)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'relative',
    }}>
      <div>
        <div style={{
          fontFamily: 'var(--mono)', fontSize: '18px', fontWeight: 600,
          color: '#fff', letterSpacing: '.02em',
        }}>SCM</div>
        <div style={{
          fontSize: '9px', color: 'rgba(255,255,255,.5)', marginTop: '3px',
          letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 500,
        }}>Portal Regulatório</div>
      </div>
      {isMobile && (
        <button onClick={onClose} aria-label="Fechar menu" style={{
          width: 44, height: 44, borderRadius: 'var(--r-md)',
          background: 'rgba(255,255,255,.12)',
          border: '1px solid rgba(255,255,255,.10)',
          cursor: 'pointer', color: '#fff', fontSize: '18px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          touchAction: 'manipulation',
        }}>✕</button>
      )}
    </div>

    {/* Profile */}
    {/* Profile */}
<div
  onClick={() => {
    if (podeVerFraseDoDia) {
      setFraseAberta(prev => !prev);
    }
  }}
  title={podeVerFraseDoDia ? 'Clique para ver a frase do dia' : undefined}
  style={{
    margin: '12px 10px 8px',
    padding: '10px 12px',
    background: fraseAberta
      ? 'rgba(255,255,255,.16)'
      : 'rgba(255,255,255,.10)',
    border: fraseAberta
      ? '1px solid rgba(255,255,255,.22)'
      : '1px solid rgba(255,255,255,.08)',
    borderRadius: 'var(--r-md)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    position: 'relative',
    cursor: podeVerFraseDoDia ? 'pointer' : 'default',
    transition: 'background var(--t-fast), border-color var(--t-fast), transform var(--t-fast)',
  }}
>
  <div
    onClick={podeEditarAvatar ? (e) => { e.stopPropagation(); setAvatarPickerOpen(o => !o); } : undefined}
    title={podeEditarAvatar ? 'Trocar avatar' : undefined}
    style={{
    width: 34,
    height: 34,
    borderRadius: 'var(--r-md)',
    background: 'linear-gradient(135deg,rgba(255,255,255,.32),rgba(255,255,255,.14))',
    border: '1px solid rgba(255,255,255,.18)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: user.avatar ? '20px' : '12px',
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
    letterSpacing: '.02em',
    cursor: podeEditarAvatar ? 'pointer' : undefined,
  }}>
    {user.avatar
      ? <span style={{ lineHeight: 1 }}>{user.avatar}</span>
      : user.initials}
  </div>

  <div style={{ flex: 1, minWidth: 0 }}>
    <div style={{
      fontSize: '12px',
      fontWeight: 600,
      color: '#fff',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      display: 'flex',
      alignItems: 'center',
      gap: '5px',
    }}>
      <span style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {user.name}
      </span>

      {podeVerFraseDoDia && (
        <span style={{
          fontSize: '10px',
          opacity: .75,
          flexShrink: 0,
        }}>
          ✨
        </span>
      )}
    </div>

    <div style={{
      fontSize: '9px',
      color: 'rgba(255,255,255,.6)',
      textTransform: 'uppercase',
      letterSpacing: '.07em',
      marginTop: '2px',
      fontWeight: 600,
    }}>
      {roleLabel}
    </div>

    {podeVerFraseDoDia && (
      <div style={{
        fontSize: '9px',
        color: 'rgba(255,255,255,.48)',
        marginTop: '3px',
        lineHeight: 1.2,
      }}>
        clique no nome para um recadinho
      </div>
    )}
  </div>

  {podeVerFraseDoDia && fraseAberta && (
    <div
      onClick={(e) => e.stopPropagation()}
      className="scm-fade-in"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 'calc(100% + 8px)',
        zIndex: 30,
        padding: '12px',
        borderRadius: '14px',
        background: 'rgba(255,255,255,.97)',
        color: '#242424',
        border: '1px solid rgba(255,255,255,.45)',
        boxShadow: '0 16px 35px rgba(0,0,0,.28)',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        marginBottom: '7px',
      }}>
        <div style={{
          fontSize: '10px',
          fontWeight: 800,
          color: 'var(--orange)',
          textTransform: 'uppercase',
          letterSpacing: '.08em',
        }}>
          Frase do dia
        </div>

        <button
          type="button"
          onClick={() => setFraseAberta(false)}
          style={{
            width: 22,
            height: 22,
            borderRadius: '8px',
            border: '1px solid rgba(0,0,0,.08)',
            background: '#fff',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      <div style={{
        fontSize: '12px',
        lineHeight: 1.5,
        color: '#333',
        fontWeight: 600,
      }}>
        {fraseDoDia}
      </div>

      <div style={{
        marginTop: '8px',
        fontSize: '10px',
        color: '#777',
        lineHeight: 1.4,
      }}>
        Amanhã tem outra. Sem pressão, só uma leve cobrança motivacional. 😄
      </div>
    </div>
  )}
</div>

    {podeEditarAvatar && avatarPickerOpen && (
      <AvatarPicker
        atual={user.avatar}
        onSelecionar={async (emoji) => {
          try { await atualizarAvatar(emoji); }
          catch (e) { alert(e?.message || 'Não foi possível salvar o avatar.'); }
          setAvatarPickerOpen(false);
        }}
        onFechar={() => setAvatarPickerOpen(false)}
      />
    )}

    {/* Nav */}
    <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px 0', scrollbarWidth: 'none' }}>
      {items.map((item, i) => {
        if (item.s) return <div key={i} style={{
          padding: '12px 9px 4px', fontSize: '9px',
          textTransform: 'uppercase', letterSpacing: '.10em',
          color: 'rgba(255,255,255,.45)', fontWeight: 600,
        }}>{item.s}</div>;
        const isActive = active === item.v;
        let itemRender = item;

if (item.v === 'feedback' && notificacoes.feedback > 0) {
  itemRender = { ...item, b: String(notificacoes.feedback) };
}

if (item.v === 'planilhas' && notificacoes.dici > 0) {
  itemRender = { ...item, b: String(notificacoes.dici) };
}

if (item.v === 'fust_funttel') {
  const totalFust =
    user.role === 'client'
      ? notificacoes.guiasFustFunttel
      : notificacoes.fustFunttel;

  if (totalFust > 0) {
    itemRender = { ...item, b: String(totalFust) };
  }
}

if (item.v === 'supervisor_coletas' && notificacoes.supervisorColetas > 0) {
  itemRender = { ...item, b: String(notificacoes.supervisorColetas) };
}

if (item.v === 'supervisor_empresas' && notificacoes.supervisorEmpresasSemConsultor > 0) {
  itemRender = { ...item, b: String(notificacoes.supervisorEmpresasSemConsultor) };
}
        return (
  <NavItem
    key={i}
    item={itemRender}
    isActive={isActive}
    onClick={() => {
      if (item.v === 'fust_funttel' && user.role === 'client') {
        localStorage.setItem(
          `guias_fust_funttel_ultima_leitura_${user.id}`,
          new Date().toISOString()
        );

        setNotificacoes(prev => ({
          ...prev,
          guiasFustFunttel: 0,
        }));
      }

      nav(item.v);
    }}
  />
);
      })}
    </div>
    {/* Logo inferior */}
    <div style={{
      padding: '18px 14px',
      marginTop: '4px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center'
    }}>
      <div style={{
        width: '100%',
        padding: '14px 10px',
        borderRadius: '14px',
        background: 'rgba(255, 255, 255, 0.08)',
        border: '1px solid rgba(255,255,255,.12)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <img
          src={logo3Url}
          alt="Logo SCM"
          style={{
            width: '100px',
            maxWidth: '100%',
            height: 'auto',
            objectFit: 'contain',
            opacity: 0.9,
            filter: 'drop-shadow(0 6px 14px rgba(0,0,0,.28))'
          }}
        />
      </div>
    </div>
    {/* Footer */}
    <div style={{ padding: '8px 8px 12px', borderTop: '1px solid rgba(255,255,255,.10)' }}>
      {[
        { i: '⚙', l: 'Configurações', action: () => nav('config') },
        { i: '↩', l: 'Sair', action: logout },
      ].map((x, i) => (
        <div key={i} onClick={x.action} style={{
          display: 'flex', alignItems: 'center', gap: '10px',
          padding: '8px 10px', borderRadius: 'var(--r-sm)',
          cursor: 'pointer', color: 'rgba(255,255,255,.65)', fontSize: '12px',
          transition: 'background var(--t-fast),color var(--t-fast)',
          marginTop: i === 0 ? 0 : '2px',
        }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.10)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,.65)'; }}>
          <span style={{ fontSize: '14px', width: '18px', textAlign: 'center' }}>{x.i}</span>{x.l}
        </div>
      ))}
    </div>
  </aside>;
}

function NavItem({ item, isActive, onClick }) {
  const isMobile = useMobile();
  const cls = 'scm-nav-item' + (isActive ? ' scm-nav-active' : '');
  return <div onClick={onClick} className={cls}
    style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: isMobile ? '11px 10px' : '8px 10px',
      minHeight: isMobile ? '44px' : undefined,
      borderRadius: 'var(--r-sm)',
      cursor: 'pointer', marginBottom: '2px',
      position: 'relative',
      color: isActive ? '#fff' : 'rgba(255,255,255,.72)',
      fontWeight: isActive ? 600 : 500,
      fontSize: '12px',
      background: isActive
        ? 'linear-gradient(90deg,rgba(255,255,255,.20),rgba(255,255,255,.10))'
        : 'transparent',
      boxShadow: isActive ? 'inset 0 0 0 1px rgba(255,255,255,.10)' : 'none',
    }}
    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.08)'; }}
    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}>
    {isActive && <div style={{
      position: 'absolute', left: -8, top: '50%', transform: 'translateY(-50%)',
      width: 3, height: 18, background: '#fff', borderRadius: '0 2px 2px 0',
      boxShadow: '0 0 8px rgba(255,255,255,.5)',
    }} />}
    <span style={{
      fontSize: '14px', width: '18px', textAlign: 'center', flexShrink: 0,
      opacity: isActive ? 1 : .85,
    }}>{item.i}</span>
    <span style={{ flex: 1 }}>{item.l}</span>
    {item.b && <span style={{
      fontSize: '9px', background: 'rgba(255,255,255,.25)',
      color: '#fff', padding: '2px 7px', borderRadius: 'var(--r-pill)',
      fontFamily: 'var(--mono)', fontWeight: 600,
    }}>{item.b}</span>}
  </div>;
}

/* ==============================
   LOGIN
   ============================== */
function formatarCnpj(valor = '') {
  const numeros = String(valor || '').replace(/\D/g, '').slice(0, 14);

  if (numeros.length <= 2) {
    return numeros;
  }

  if (numeros.length <= 5) {
    return numeros.replace(/^(\d{2})(\d+)/, '$1.$2');
  }

  if (numeros.length <= 8) {
    return numeros.replace(/^(\d{2})(\d{3})(\d+)/, '$1.$2.$3');
  }

  if (numeros.length <= 12) {
    return numeros.replace(/^(\d{2})(\d{3})(\d{3})(\d+)/, '$1.$2.$3/$4');
  }

  return numeros.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function cnpjPossui14Numeros(valor = '') {
  return normalizarCnpj(valor).length === 14;
}

function Login() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);

  const [modoRegistro, setModoRegistro] = useState(false);
  const [nome, setNome] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');

  const [cnpj, setCnpj] = useState('');

  const [ehGrupo, setEhGrupo] = useState(false);
  const [empresasGrupo, setEmpresasGrupo] = useState([
    {
      nome: '',
      cnpj: '',
    },
  ]);

  const entrar = async (e) => {
    e.preventDefault();

    try {
      setCarregando(true);
      setErro('');

      await login(email, senha);
    } catch (error) {
      setErro(error.message || 'E-mail ou senha inválidos.');
    } finally {
      setCarregando(false);
    }
  };
  const atualizarCnpjPrincipal = (valor) => {
    setCnpj(formatarCnpj(valor));
  };

  const atualizarEmpresaGrupo = (index, campo, valor) => {
    setEmpresasGrupo(prev => {
      const lista = [...prev];

      lista[index] = {
        ...lista[index],
        [campo]: campo === 'cnpj' ? formatarCnpj(valor) : valor,
      };

      return lista;
    });
  };

  const adicionarEmpresaGrupo = () => {
    setEmpresasGrupo(prev => [
      ...prev,
      {
        nome: '',
        cnpj: '',
      },
    ]);
  };

  const removerEmpresaGrupo = (index) => {
    setEmpresasGrupo(prev => prev.filter((_, i) => i !== index));
  };
  const registrar = async (e) => {
    e.preventDefault();

    try {
      setCarregando(true);
      setErro('');

      if (!nome.trim()) {
        throw new Error('Informe o nome da empresa ou responsável.');
      }

      if (!email.trim()) {
        throw new Error('Informe seu e-mail.');
      }

      if (senha.length < 6) {
        throw new Error('A senha deve ter pelo menos 6 caracteres.');
      }

      if (senha !== confirmarSenha) {
        throw new Error('As senhas não conferem.');
      }

      const emailLimpo = email.trim().toLowerCase();
      const cnpjLimpo = normalizarCnpj(cnpj);

      if (!cnpjPossui14Numeros(cnpj)) {
        throw new Error('Informe um CNPJ válido com 14 números.');
      }

      let empresasGrupoValidas = [];

      if (ehGrupo) {
        empresasGrupoValidas = empresasGrupo
          .map(item => ({
            nome: item.nome.trim(),
            cnpj: normalizarCnpj(item.cnpj),
          }))
          .filter(item => item.nome || item.cnpj);

        if (empresasGrupoValidas.length === 0) {
          throw new Error('Adicione pelo menos uma empresa ao grupo.');
        }

        const empresaIncompleta = empresasGrupoValidas.some(item => {
          return !item.nome || item.cnpj.length !== 14;
        });

        if (empresaIncompleta) {
          throw new Error('Todas as empresas do grupo precisam ter nome e CNPJ válido.');
        }
      }

      const { data, error } = await supabase.auth.signUp({
        email: emailLimpo,
        password: senha,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        throw new Error(error.message || 'Erro ao criar usuário no Supabase Auth.');
      }

      if (!data.user) {
        throw new Error('Usuário criado, mas não foi possível obter os dados da conta.');
      }

      const nomeCliente = nome.trim();
      const nomeEmpresa = nomeCliente;
      const grupoId = ehGrupo && window.crypto?.randomUUID
        ? window.crypto.randomUUID()
        : null;

      const { error: usuarioError } = await supabase
        .from('usuarios')
        .insert({
          id: data.user.id,
          nome: nomeCliente,
          email: emailLimpo,
          role: 'client',
          cnpj: cnpjLimpo,
          empresa_nome: nomeEmpresa,
          ativo: true,
        });

      if (usuarioError) {
        throw new Error(usuarioError.message || 'Conta criada no Auth, mas não cadastrada na tabela usuarios.');
      }

      const clientesParaCadastrar = [
        {
          usuario_id: data.user.id,
          nome: nomeEmpresa,
          cnpj: cnpjLimpo,
          email: emailLimpo,
          consultor: null,
          status: 'ativo',
          tipo_cliente: ehGrupo ? 'grupo' : 'empresa',
          grupo_id: grupoId,
          grupo_nome: ehGrupo ? nomeEmpresa : null,
          empresa_principal: true,
        },
        ...empresasGrupoValidas.map(empresa => ({
          usuario_id: data.user.id,
          nome: empresa.nome,
          cnpj: empresa.cnpj,
          email: emailLimpo,
          consultor: null,
          status: 'ativo',
          tipo_cliente: 'empresa_grupo',
          grupo_id: grupoId,
          grupo_nome: nomeEmpresa,
          empresa_principal: false,
        })),
      ];

      const { error: clienteError } = await supabase
        .from('clientes')
        .insert(clientesParaCadastrar);

      if (clienteError) {
        throw new Error(clienteError.message || 'Conta criada, mas empresa não cadastrada na tabela clientes.');
      }

      alert(
        ehGrupo
          ? 'Grupo cadastrado! Verifique seu e-mail e clique no link de confirmação antes de fazer login.'
          : 'Conta criada! Verifique seu e-mail e clique no link de confirmação antes de fazer login.'
      );

      setModoRegistro(false);
      setNome('');
      setEmail('');
      setSenha('');
      setConfirmarSenha('');
      setCnpj('');
      setEhGrupo(false);
      setEmpresasGrupo([{ nome: '', cnpj: '' }]);

    } catch (error) {
      console.error('Erro ao registrar:', error);
      setErro(error.message || 'Erro ao criar conta.');
    } finally {
      setCarregando(false);
    }
  };
  const reenviarConfirmacao = async () => {
    try {
      setCarregando(true);
      setErro('');

      const emailLimpo = email.trim().toLowerCase();

      if (!emailLimpo) {
        throw new Error('Digite seu e-mail antes de reenviar o link de confirmação.');
      }

      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: emailLimpo,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (error) {
        if (error.message.includes('rate limit')) {
          throw new Error('Limite de envio atingido. Aguarde alguns minutos e tente novamente.');
        }

        throw new Error(error.message || 'Erro ao reenviar confirmação.');
      }

      alert('Link de confirmação reenviado! Verifique seu e-mail e a caixa de spam.');
    } catch (error) {
      console.error('Erro ao reenviar confirmação:', error);
      setErro(error.message || 'Erro ao reenviar confirmação.');
    } finally {
      setCarregando(false);
    }
  };
  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    border: '1px solid rgba(0,0,0,.10)',
    borderRadius: '14px',
    fontSize: '13px',
    fontFamily: 'var(--font)',
    outline: 'none',
    background: 'rgba(255,255,255,.96)',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    display: 'block',
    fontSize: '12px',
    color: 'var(--muted)',
    marginBottom: '6px',
  };

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
      backgroundImage: `url(${backUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      boxSizing: 'border-box',
    }}>


      <div style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.60)',
        zIndex: 1,
      }} />

      <div style={{
  width: '100%',
  maxWidth: '430px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  marginBottom: '22px',
  position: 'relative',
  zIndex: 2,
}}>
  <div style={{
    width: 86,
    height: 86,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 12px',
  }}>
    <img
      src={logoUrl}
      alt="Logo SCM"
      style={{
        width: 86,
        height: 86,
        objectFit: 'contain',
        objectPosition: 'center',
        display: 'block',
        filter: 'drop-shadow(0 8px 18px rgba(0,0,0,.35))',
      }}
    />
  </div>

        <div style={{
          fontSize: '24px',
          fontWeight: 700,
          color: '#fff',
          textShadow: '0 3px 12px rgba(0,0,0,.45)',
        }}>
          Portal Regulatório
        </div>

        <div style={{
          fontSize: '13px',
          color: 'rgba(255,255,255,.78)',
          marginTop: '4px',
        }}>
          SCM Engenharia · scmengenharia.com.br
        </div>
      </div>

      <form
        onSubmit={modoRegistro ? registrar : entrar}
        style={{
          width: '100%',
          maxWidth: '430px',
          position: 'relative',
          zIndex: 2,
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          border: '1px solid rgba(255,255,255,0.45)',
          borderRadius: '24px',
          padding: '28px',
          boxShadow: '0 24px 70px rgba(0,0,0,.35)',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        {modoRegistro && (
          <div style={{ marginBottom: '14px' }}>
            <label style={labelStyle}>
              Nome da empresa ou responsável
            </label>

            <input
              type="text"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex: SCM LTDA"
              required={modoRegistro}
              style={inputStyle}
            />
          </div>
        )}
        {modoRegistro && (
          <>
            <div style={{ marginBottom: '15px' }}>
              <label style={labelStyle}>
                CNPJ da empresa principal
              </label>

              <input
                type="text"
                value={cnpj}
                onChange={(e) => atualizarCnpjPrincipal(e.target.value)}
                placeholder="00.000.000/0001-00"
                maxLength={18}
                inputMode="numeric"
                style={{
                  ...inputStyle,
                  fontFamily: 'var(--mono)',
                }}
              />

              <div style={{
                fontSize: '11px',
                color: 'var(--muted)',
                marginTop: '5px',
              }}>
                Digite apenas os números. O portal coloca os pontos, barra e traço automaticamente.
              </div>
            </div>

            <div style={{
              marginBottom: '15px',
              padding: '12px',
              borderRadius: '14px',
              background: 'rgba(250,250,248,.92)',
              border: '1px solid rgba(0,0,0,.08)',
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--muted)',
              }}>
                <input
                  type="checkbox"
                  checked={ehGrupo}
                  onChange={(e) => setEhGrupo(e.target.checked)}
                />

                Este cadastro é de um grupo com mais de uma empresa/CNPJ
              </label>

              {ehGrupo && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    marginBottom: '8px',
                    color: 'var(--text)',
                  }}>
                    Empresas do grupo
                  </div>

                  {empresasGrupo.map((empresa, index) => (
                    <div
                      key={index}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 165px auto',
                        gap: '8px',
                        marginBottom: '8px',
                        alignItems: 'center',
                      }}
                    >
                      <input
                        type="text"
                        value={empresa.nome}
                        onChange={(e) => atualizarEmpresaGrupo(index, 'nome', e.target.value)}
                        placeholder="Nome da empresa"
                        style={{
                          ...inputStyle,
                          padding: '10px 12px',
                          borderRadius: '12px',
                        }}
                      />

                      <input
                        type="text"
                        value={empresa.cnpj}
                        onChange={(e) => atualizarEmpresaGrupo(index, 'cnpj', e.target.value)}
                        placeholder="00.000.000/0001-00"
                        maxLength={18}
                        inputMode="numeric"
                        style={{
                          ...inputStyle,
                          padding: '10px 12px',
                          borderRadius: '12px',
                          fontFamily: 'var(--mono)',
                        }}
                      />

                      <button
                        type="button"
                        onClick={() => removerEmpresaGrupo(index)}
                        disabled={empresasGrupo.length === 1}
                        style={{
                          width: '36px',
                          height: '36px',
                          borderRadius: '10px',
                          border: '1px solid #F5C6C6',
                          background: '#FFF0F0',
                          color: 'var(--red)',
                          cursor: empresasGrupo.length === 1 ? 'not-allowed' : 'pointer',
                          opacity: empresasGrupo.length === 1 ? 0.5 : 1,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={adicionarEmpresaGrupo}
                    style={{
                      width: '100%',
                      marginTop: '4px',
                      padding: '10px',
                      background: '#fff',
                      color: 'var(--orange)',
                      border: '1px dashed rgba(217,95,0,.45)',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    + Adicionar outro CNPJ ao grupo
                  </button>

                  <div style={{
                    fontSize: '11px',
                    color: 'var(--muted)',
                    marginTop: '8px',
                    lineHeight: 1.5,
                  }}>
                    Cada CNPJ será cadastrado como uma empresa separada, mas vinculado ao mesmo grupo.
                    Depois o cliente poderá enviar planilhas para cada empresa do grupo.
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ marginBottom: '14px' }}>
          <label style={labelStyle}>
            {modoRegistro ? 'E-mail' : 'E-mail ou CNPJ'}
          </label>

          <input
            type="text"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={modoRegistro ? 'Digite seu e-mail' : 'Digite seu e-mail ou CNPJ'}
            required
            inputMode="email"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label style={labelStyle}>
            Senha
          </label>

          <input
            type="password"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            placeholder="Digite sua senha"
            required
            style={inputStyle}
          />
        </div>

        {modoRegistro && (
          <>
            <div style={{ marginBottom: '15px' }}>
              <label style={labelStyle}>
                Confirmar senha
              </label>

              <input
                type="password"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                placeholder="Confirme sua senha"
                required={modoRegistro}
                style={inputStyle}
              />
            </div>


          </>
        )}

        {erro && (
          <div style={{
            background: '#FFF0F0',
            color: 'var(--red)',
            border: '1px solid #F5C6C6',
            padding: '10px 12px',
            borderRadius: '14px',
            fontSize: '12px',
            marginBottom: '12px',
          }}>
            {erro}
          </div>
        )}

        <button
          type="submit"
          disabled={carregando}
          style={{
            width: '100%',
            padding: '13px',
            background: 'var(--orange)',
            color: '#fff',
            border: '1px solid var(--orange)',
            borderRadius: '14px',
            fontSize: '13px',
            fontWeight: 700,
            cursor: carregando ? 'not-allowed' : 'pointer',
            opacity: carregando ? 0.7 : 1,
            boxShadow: '0 10px 22px rgba(217,95,0,.25)',
          }}
        >
          {carregando
            ? (modoRegistro ? 'Criando conta...' : 'Entrando...')
            : (modoRegistro ? 'Criar conta' : 'Entrar')}
        </button>
        {modoRegistro && (
          <button
            type="button"
            onClick={reenviarConfirmacao}
            disabled={carregando}
            style={{
              width: '100%',
              marginTop: '10px',
              padding: '12px',
              background: '#fff',
              color: 'var(--orange)',
              border: '1px solid rgba(217,95,0,.35)',
              borderRadius: '14px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: carregando ? 'not-allowed' : 'pointer',
              opacity: carregando ? 0.7 : 1,
            }}
          >
            Reenviar link de confirmação
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setModoRegistro(!modoRegistro);
            setErro('');
            setEmail('');
            setSenha('');
            setConfirmarSenha('');
          }}
          style={{
            width: '100%',
            marginTop: '10px',
            padding: '12px',
            background: 'rgba(255,255,255,.45)',
            color: 'var(--orange)',
            border: '1px solid rgba(0,0,0,.10)',
            borderRadius: '14px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {modoRegistro ? 'Já tenho conta' : 'Criar nova conta'}
        </button>

      </form>

      <p style={{
        fontSize: '11px',
        color: 'rgba(255,255,255,.75)',
        marginTop: '26px',
        textAlign: 'center',
        position: 'relative',
        zIndex: 2,
      }}>
        PORTAL SCM ENGENHARIA - DESENVOLVIDO POR SCM ENGENHARIA LTDA 
      </p>
    </div>
  );
}

function GraficoEnviosCliente({
  isMobile,
  carregando,
  erro,
  dados = [],
  maiorValor = 1,
  totalEnvios = 0,
}) {
  const [barraAtiva, setBarraAtiva] = useState(null);

  const totalLinhas = dados.reduce((total, item) => {
    return total + (Number(item.linhas) || 0);
  }, 0);

  const melhorMes = dados.reduce((maior, item) => {
    if (!maior || item.total > maior.total) return item;
    return maior;
  }, null);

  return (
    <div style={{
      border: '1px solid rgba(217,95,0,.18)',
      borderRadius: '20px',
      padding: '16px',
      background: 'linear-gradient(135deg, #FFFFFF 0%, #FFF8F1 55%, #FFF1E4 100%)',
      boxShadow: '0 14px 35px rgba(217,95,0,.08)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        position: 'absolute',
        width: '180px',
        height: '180px',
        borderRadius: '50%',
        background: 'rgba(217,95,0,.08)',
        top: '-90px',
        right: '-70px',
        pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '14px',
        position: 'relative',
        zIndex: 1,
      }}>
        <div>
          <div style={{
            fontSize: '15px',
            fontWeight: 800,
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            📊 Envios por competência
          </div>

          <div style={{
            fontSize: '12px',
            color: 'var(--muted)',
            marginTop: '4px',
            lineHeight: 1.5,
          }}>
            Evolução dos últimos meses com planilhas enviadas ao portal.
          </div>
        </div>

        <Pill
          label={`${totalEnvios} envio(s)`}
          color="orange"
        />
      </div>

      {carregando ? (
        <div style={{
          padding: '42px 20px',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: '13px',
          background: 'rgba(255,255,255,.72)',
          border: '1px dashed rgba(217,95,0,.25)',
          borderRadius: '16px',
        }}>
          Carregando gráfico...
        </div>
      ) : erro ? (
        <div style={{
          padding: '14px',
          borderRadius: '14px',
          background: '#FFF0F0',
          border: '1px solid #F5C6C6',
          color: 'var(--red)',
          fontSize: '12px',
        }}>
          {erro}
        </div>
      ) : dados.length === 0 ? (
        <div style={{
          padding: '42px 20px',
          textAlign: 'center',
          color: 'var(--muted)',
          fontSize: '13px',
          border: '1px dashed rgba(217,95,0,.25)',
          borderRadius: '16px',
          background: 'rgba(255,255,255,.72)',
        }}>
          <div style={{ fontSize: '28px', marginBottom: '8px' }}>📁</div>
          Nenhuma planilha enviada ainda.
        </div>
      ) : (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: '10px',
            marginBottom: '16px',
            position: 'relative',
            zIndex: 1,
          }}>
            <div style={{
              padding: '12px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,.78)',
              border: '1px solid rgba(217,95,0,.14)',
            }}>
              <div style={{
                fontSize: '20px',
                fontWeight: 800,
                fontFamily: 'var(--mono)',
                color: 'var(--orange)',
              }}>
                {totalEnvios}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Total de envios
              </div>
            </div>

            <div style={{
              padding: '12px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,.78)',
              border: '1px solid rgba(217,95,0,.14)',
            }}>
              <div style={{
                fontSize: '20px',
                fontWeight: 800,
                fontFamily: 'var(--mono)',
                color: 'var(--admin-bg)',
              }}>
                {totalLinhas}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Linhas processadas
              </div>
            </div>

            <div style={{
              padding: '12px',
              borderRadius: '16px',
              background: 'rgba(255,255,255,.78)',
              border: '1px solid rgba(217,95,0,.14)',
            }}>
              <div style={{
                fontSize: '20px',
                fontWeight: 800,
                fontFamily: 'var(--mono)',
                color: '#1E7E34',
              }}>
                {melhorMes?.mes || '—'}
              </div>
              <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                Competência
              </div>
            </div>
          </div>

          <div style={{
            height: isMobile ? '230px' : '260px',
            display: 'flex',
            alignItems: 'end',
            gap: isMobile ? '8px' : '12px',
            padding: '22px 8px 8px',
            borderTop: '1px solid rgba(217,95,0,.14)',
            position: 'relative',
          }}>
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: `${44 + i * 48}px`,
                  height: '1px',
                  background: 'rgba(0,0,0,.045)',
                }}
              />
            ))}

            {dados.map((item, index) => {
              const altura = Math.max((item.total / maiorValor) * 170, 24);
              const ativo = barraAtiva === index;

              return (
                <div
                  key={item.mes}
                  onMouseEnter={() => setBarraAtiva(index)}
                  onMouseLeave={() => setBarraAtiva(null)}
                  style={{
                    flex: 1,
                    minWidth: isMobile ? '48px' : '58px',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'end',
                    gap: '8px',
                    position: 'relative',
                    zIndex: 1,
                  }}
                >
                  {ativo && (
                    <div style={{
                      position: 'absolute',
                      bottom: `${altura + 58}px`,
                      left: '50%',
                      transform: 'translateX(-50%)',
                      background: '#18171A',
                      color: '#fff',
                      padding: '8px 10px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 10px 24px rgba(0,0,0,.22)',
                      zIndex: 3,
                    }}>
                      <strong>{item.total}</strong> envio(s) · {item.linhas} linhas
                    </div>
                  )}

                  <div style={{
                    fontSize: '12px',
                    fontWeight: 800,
                    color: ativo ? 'var(--orange)' : 'var(--text)',
                    fontFamily: 'var(--mono)',
                  }}>
                    {item.total}
                  </div>

                  <div style={{
                    width: '100%',
                    maxWidth: ativo ? '52px' : '46px',
                    height: `${altura}px`,
                    borderRadius: '16px 16px 8px 8px',
                    background: ativo
                      ? 'linear-gradient(180deg, #FF8A2A 0%, var(--orange) 55%, #9A4200 100%)'
                      : 'linear-gradient(180deg, var(--orange) 0%, #B04D00 100%)',
                    boxShadow: ativo
                      ? '0 14px 30px rgba(217,95,0,.34)'
                      : '0 10px 22px rgba(217,95,0,.20)',
                    transition: 'all .22s ease',
                    cursor: 'pointer',
                    border: '1px solid rgba(255,255,255,.45)',
                  }} />

                  <div style={{
                    fontSize: '10px',
                    color: 'var(--faint)',
                    fontFamily: 'var(--mono)',
                    whiteSpace: 'nowrap',
                  }}>
                    {item.mes}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Dashboard({ onNav }) {
  const { user, isAdmin, isConsult, isClient } = useAuth();
  const isMobile = useMobile();

  const [coletas, setColetas] = useState(COLETAS_INIT);
  const [clientes, setClientes] = useState([]);

  const [planilhasDashboard, setPlanilhasDashboard] = useState([]);
  const [carregandoPlanilhasDashboard, setCarregandoPlanilhasDashboard] = useState(false);
  const [erroPlanilhasDashboard, setErroPlanilhasDashboard] = useState('');

  const [empresaCliente, setEmpresaCliente] = useState(null);
  const [empresasCliente, setEmpresasCliente] = useState([]);
  const [carregandoEmpresaCliente, setCarregandoEmpresaCliente] = useState(false);

  const [mostrarFormEmpresaGrupo, setMostrarFormEmpresaGrupo] = useState(false);
  const [salvandoEmpresaGrupo, setSalvandoEmpresaGrupo] = useState(false);
  const [erroEmpresaGrupo, setErroEmpresaGrupo] = useState('');

  const [novaEmpresaGrupo, setNovaEmpresaGrupo] = useState({
    nome: '',
    cnpj: '',
  });

  const chaveIntegracoes = `scm_integracoes_${user?.cnpj || user?.email || 'geral'}`;

  const [integracoes, setIntegracoes] = useState({});
  const [consultores, setConsultores] = useState([]);
  const [carregandoConsultores, setCarregandoConsultores] = useState(false);

  useEffect(() => {
    try {
      const salvas = JSON.parse(localStorage.getItem(chaveIntegracoes) || '{}');
      setIntegracoes(salvas);
    } catch (error) {
      console.error('Erro ao carregar integrações:', error);
      setIntegracoes({});
    }
  }, [chaveIntegracoes]);

  const atualizarIntegracao = (plataformaId, campo, valor) => {
    setIntegracoes(prev => {
      const atualizadas = {
        ...prev,
        [plataformaId]: {
          ...(prev[plataformaId] || {}),
          [campo]: valor,
        },
      };

      localStorage.setItem(chaveIntegracoes, JSON.stringify(atualizadas));

      return atualizadas;
    });
  };

  const totalIntegracoesConfiguradas = Object.values(integracoes)
    .filter(item => item?.empresaId?.trim())
    .length;
  const [carregandoClientes, setCarregandoClientes] = useState(false);
  const [erroClientes, setErroClientes] = useState('');

  const [mostrarFormCliente, setMostrarFormCliente] = useState(false);
  const [salvandoCliente, setSalvandoCliente] = useState(false);
  const [erroCadastroCliente, setErroCadastroCliente] = useState('');

  const [novoCliente, setNovoCliente] = useState({
    nome: '',
    cnpj: '',
    email: '',
    consultor: '',
    status: 'ativo',
  });

  const carregarClientes = useCallback(async () => {
    try {
      setCarregandoClientes(true);
      setErroClientes('');

      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .order('criado_em', { ascending: false });

      if (error) {
        console.error('ERRO DA EDGE FUNCTION:', error);

        let mensagemErro = error.message || 'Erro ao chamar a Edge Function.';

        if (error.context) {
          try {
            const detalhe = await error.context.json();
            console.error('DETALHE DA EDGE FUNCTION:', detalhe);

            mensagemErro =
              detalhe.error ||
              detalhe.message ||
              JSON.stringify(detalhe);
          } catch {
            try {
              const texto = await error.context.text();
              console.error('TEXTO DA EDGE FUNCTION:', texto);

              if (texto) {
                mensagemErro = texto;
              }
            } catch { }
          }
        }

        throw new Error(mensagemErro);
      }

      setClientes(data || []);
    } catch (error) {
      console.error('Erro ao buscar clientes no Supabase:', error);
      setErroClientes(error.message || 'Erro ao carregar clientes.');
    } finally {
      setCarregandoClientes(false);
    }
  }, []);

  const carregarPlanilhasDashboard = useCallback(async () => {
    if (!isClient || !user?.id) {
      setPlanilhasDashboard([]);
      return;
    }

    try {
      setCarregandoPlanilhasDashboard(true);
      setErroPlanilhasDashboard('');

      const { data, error } = await supabase
        .from('planilhas_coleta')
        .select('*')
        .eq('usuario_id', user.id)
        .order('criado_em', { ascending: false });

      if (error) {
        throw error;
      }

      setPlanilhasDashboard(data || []);
    } catch (error) {
      console.error('Erro ao carregar planilhas no painel do cliente:', error);
      setErroPlanilhasDashboard(error.message || 'Erro ao carregar gráfico de planilhas.');
    } finally {
      setCarregandoPlanilhasDashboard(false);
    }
  }, [isClient, user]);

  const carregarEmpresaCliente = useCallback(async () => {
    if (!user?.id && !user?.cnpj) return;

    try {
      setCarregandoEmpresaCliente(true);

      let listaEmpresas = [];

      if (user?.id) {
        const { data, error } = await supabase
          .from('clientes')
          .select('*')
          .eq('usuario_id', user.id)
          .order('empresa_principal', { ascending: false })
          .order('nome', { ascending: true });

        if (error) {
          throw error;
        }

        listaEmpresas = data || [];
      }

      if (listaEmpresas.length === 0 && user?.cnpj) {
        const { data, error } = await supabase
          .from('clientes')
          .select('*')
          .eq('cnpj', normalizarCnpj(user.cnpj));

        if (error) {
          throw error;
        }

        listaEmpresas = data || [];
      }

      const empresaPrincipal =
        listaEmpresas.find(empresa => empresa.empresa_principal === true) ||
        listaEmpresas[0] ||
        null;

      setEmpresasCliente(listaEmpresas);
      setEmpresaCliente(empresaPrincipal);
    } catch (error) {
      console.error('Erro ao carregar empresas do cliente:', error);
      setEmpresasCliente([]);
      setEmpresaCliente(null);
    } finally {
      setCarregandoEmpresaCliente(false);
    }
  }, [user]);
  const atualizarNovaEmpresaGrupo = (campo, valor) => {
    setNovaEmpresaGrupo(prev => ({
      ...prev,
      [campo]: campo === 'cnpj' ? formatarCnpj(valor) : valor,
    }));
  };

  const limparNovaEmpresaGrupo = () => {
    setNovaEmpresaGrupo({
      nome: '',
      cnpj: '',
    });

    setErroEmpresaGrupo('');
  };

  const salvarEmpresaGrupo = async (e) => {
    e.preventDefault();

    try {
      setSalvandoEmpresaGrupo(true);
      setErroEmpresaGrupo('');

      if (!empresaCliente) {
        throw new Error('Não foi possível identificar a empresa principal.');
      }

      const nomeLimpo = novaEmpresaGrupo.nome.trim();
      const cnpjLimpo = normalizarCnpj(novaEmpresaGrupo.cnpj);

      if (!nomeLimpo) {
        throw new Error('Informe o nome da empresa.');
      }

      if (cnpjLimpo.length !== 14) {
        throw new Error('Informe um CNPJ válido com 14 números.');
      }

      const jaExisteNoGrupo = empresasCliente.some(empresa => {
        return normalizarCnpj(empresa.cnpj) === cnpjLimpo;
      });

      if (jaExisteNoGrupo) {
        throw new Error('Este CNPJ já está cadastrado neste grupo.');
      }

      const { data: empresaExistente, error: erroBusca } = await supabase
        .from('clientes')
        .select('id, nome, cnpj')
        .eq('cnpj', cnpjLimpo)
        .maybeSingle();

      if (erroBusca) {
        throw erroBusca;
      }

      if (empresaExistente) {
        throw new Error(`Este CNPJ já está cadastrado para: ${empresaExistente.nome}`);
      }

      let grupoId = empresaCliente.grupo_id;
      const grupoNome = empresaCliente.grupo_nome || empresaCliente.nome;

      if (!grupoId) {
        grupoId = window.crypto?.randomUUID
          ? window.crypto.randomUUID()
          : String(Date.now());

        const { error: erroAtualizarPrincipal } = await supabase
          .from('clientes')
          .update({
            usuario_id: user?.id,
            tipo_cliente: 'grupo',
            grupo_id: grupoId,
            grupo_nome: grupoNome,
            empresa_principal: true,
          })
          .eq('id', empresaCliente.id);

        if (erroAtualizarPrincipal) {
          throw erroAtualizarPrincipal;
        }
      }

      const { error: erroInsert } = await supabase
        .from('clientes')
        .insert({
          usuario_id: user?.id,
          nome: nomeLimpo,
          cnpj: cnpjLimpo,
          email: empresaCliente.email || user?.email || null,
          consultor: empresaCliente.consultor || null,
          status: 'ativo',
          tipo_cliente: 'empresa_grupo',
          grupo_id: grupoId,
          grupo_nome: grupoNome,
          empresa_principal: false,
        });

      if (erroInsert) {
        if (
          erroInsert.message?.includes('duplicate key') ||
          erroInsert.message?.includes('clientes_cnpj_key')
        ) {
          throw new Error('Este CNPJ já existe cadastrado no portal.');
        }

        throw erroInsert;
      }

      alert('Empresa adicionada ao grupo com sucesso!');

      limparNovaEmpresaGrupo();
      setMostrarFormEmpresaGrupo(false);

      await carregarEmpresaCliente();
    } catch (error) {
      console.error('Erro ao adicionar empresa ao grupo:', error);
      setErroEmpresaGrupo(error.message || 'Erro ao adicionar empresa ao grupo.');
    } finally {
      setSalvandoEmpresaGrupo(false);
    }
  };
  const carregarConsultores = useCallback(async () => {
    try {
      setCarregandoConsultores(true);

      const { data, error } = await supabase
        .from('usuarios')
        .select('id, nome, email, role, ativo')
        .eq('role', 'consult')
        .eq('ativo', true)
        .order('nome', { ascending: true });

      if (error) {
        throw error;
      }

      setConsultores(data || []);
    } catch (error) {
      console.error('Erro ao carregar consultores:', error);
    } finally {
      setCarregandoConsultores(false);
    }
  }, []);

  const atualizarCampoNovoCliente = (campo, valor) => {
    setNovoCliente(prev => ({
      ...prev,
      [campo]: valor,
    }));
  };

  const limparFormularioCliente = () => {
    setNovoCliente({
      nome: '',
      cnpj: '',
      email: '',
      consultor: '',
      status: 'ativo',
    });

    setErroCadastroCliente('');
  };

  const cadastrarCliente = useCallback(async (e) => {
    e.preventDefault();

    try {
      setSalvandoCliente(true);
      setErroCadastroCliente('');

      if (!novoCliente.nome.trim() || !novoCliente.cnpj.trim()) {
        throw new Error('Nome e CNPJ são obrigatórios.');
      }

      const { error } = await supabase
        .from('clientes')
        .insert({
          nome: novoCliente.nome.trim(),
          cnpj: novoCliente.cnpj.replace(/\D/g, ''),
          email: novoCliente.email.trim() || null,
          consultor: novoCliente.consultor.trim() || null,
          status: novoCliente.status || 'ativo',
        });

      if (error) {
        throw error;
      }

      setMostrarFormCliente(false);
      limparFormularioCliente();
      await carregarClientes();

      alert('Cliente cadastrado com sucesso!');
    } catch (error) {
      console.error('Erro ao cadastrar cliente no Supabase:', error);
      setErroCadastroCliente(error.message || 'Erro ao cadastrar cliente.');
    } finally {
      setSalvandoCliente(false);
    }
  }, [novoCliente, carregarClientes]);



  const alterarConsultorDoCliente = useCallback(async (cliente, novoConsultor) => {
    try {
      const { error } = await supabase
        .from('clientes')
        .update({
          consultor: novoConsultor || null,
        })
        .eq('id', cliente.id);

      if (error) {
        throw error;
      }

      await carregarClientes();
    } catch (error) {
      console.error('Erro ao alterar consultor no Supabase:', error);
      alert(error.message || 'Erro ao alterar consultor.');
    }
  }, [carregarClientes]);

  const excluirCliente = useCallback(async (cliente) => {
    if (!confirm(`Deseja excluir o cliente "${cliente.nome}"?`)) return;

    try {
      const { error } = await supabase
        .from('clientes')
        .delete()
        .eq('id', cliente.id);

      if (error) {
        throw error;
      }

      await carregarClientes();

      alert('Cliente excluído com sucesso!');
    } catch (error) {
      console.error('Erro ao excluir cliente no Supabase:', error);
      alert(error.message || 'Não foi possível excluir o cliente.');
    }
  }, [carregarClientes]);

  useEffect(() => {
    if (isAdmin || isConsult || isClient) {
      carregarClientes();
    }

    if (isAdmin) {
      carregarConsultores();
    }

    if (isClient) {
      carregarEmpresaCliente();
      carregarPlanilhasDashboard();
    }
  }, [
    isAdmin,
    isConsult,
    isClient,
    carregarClientes,
    carregarConsultores,
    carregarEmpresaCliente,
    carregarPlanilhasDashboard
  ]);
  const nomeConsultorLogado = user?.nome || user?.name || '';

const clientesDoConsultor = clientes.filter(cliente => {
  return consultorPertenceAoUsuario(cliente.consultor, user);
});

  const normalizarStatusDashboard = (status) => {
    if (!status) return 'recebido';
    if (status === 'Importada') return 'recebido';
    return status;
  };

  const planilhasVisiveisDashboard = isClient ? planilhasDashboard : [];

  const totalPlanilhasDashboard = planilhasVisiveisDashboard.length;

  const totalLinhasDashboard = planilhasVisiveisDashboard.reduce((total, item) => {
    return total + (Number(item.total_final) || 0);
  }, 0);

  const totalDuplicidadesDashboard = planilhasVisiveisDashboard.reduce((total, item) => {
    return total + (Number(item.duplicidades) || 0);
  }, 0);

  const planilhasPendentesDashboard = planilhasVisiveisDashboard.filter(item => {
    const status = normalizarStatusDashboard(item.status);

    return !['finalizado', 'comprovante_anexado'].includes(status);
  }).length;

  const obterMesAnoPlanilha = (item) => {
    const ano = Number(item.competencia_ano);
    const mes = Number(item.competencia_mes);

    if (ano && mes) {
      return {
        chave: `${String(mes).padStart(2, '0')}/${ano}`,
        ordem: Number(`${ano}${String(mes).padStart(2, '0')}`),
      };
    }

    const data = item.criado_em ? new Date(item.criado_em) : new Date();

    return {
      chave: `${String(data.getMonth() + 1).padStart(2, '0')}/${data.getFullYear()}`,
      ordem: Number(`${data.getFullYear()}${String(data.getMonth() + 1).padStart(2, '0')}`),
    };
  };

  const graficoEnviosMensais = Object.values(
    planilhasVisiveisDashboard.reduce((acc, item) => {
      const mesAno = obterMesAnoPlanilha(item);

      if (!acc[mesAno.chave]) {
        acc[mesAno.chave] = {
          mes: mesAno.chave,
          ordem: mesAno.ordem,
          total: 0,
          linhas: 0,
        };
      }

      acc[mesAno.chave].total += 1;
      acc[mesAno.chave].linhas += Number(item.total_final) || 0;

      return acc;
    }, {})
  )
    .sort((a, b) => a.ordem - b.ordem)
    .slice(-6);

  const maiorEnvioMensal = Math.max(
    ...graficoEnviosMensais.map(item => item.total),
    1
  );

  const resumoStatusPlanilhas = [
    {
      label: 'Recebidas',
      status: 'recebido',
      color: 'blue',
    },
    {
      label: 'Em processamento',
      status: 'em_processamento',
      color: 'orange',
    },
    {
      label: 'Finalizadas',
      status: 'finalizado',
      color: 'red',
    },
    {
      label: 'Com comprovante',
      status: 'comprovante_anexado',
      color: 'green',
    },
  ].map(item => ({
    ...item,
    total: planilhasVisiveisDashboard.filter(planilha => {
      return normalizarStatusDashboard(planilha.status) === item.status;
    }).length,
  }));

  const funcionalidadesFuturasDashboard = [


  ];
  return <div>
    {isAdmin && <Banner role="admin" icon="🛡" title="Administrador — acesso total à plataforma" sub="Gerencie usuários, edite o site, visualize todos os clientes e processos." />}
    {isConsult && <Banner role="consult" icon="📋" title="Consultor — minhas empresas e lançamentos" sub="Acompanhe o status das coletas das empresas sob sua responsabilidade." />}
    {isClient && <Banner role="client" icon="◉" title="Cliente — seus dados regulatórios em tempo real" sub="Acompanhe coletas, processos e documentos. Edite e envie sua coleta DICI." />}

    {isConsult && <ViewConsultorDashboard />}

    {(isAdmin || isClient) && (
      <div style={{
        display: isMobile ? 'flex' : 'grid',
        gridTemplateColumns: isMobile ? undefined : 'repeat(4,1fr)',
        gap: '11px',
        overflowX: isMobile ? 'auto' : undefined,
        scrollSnapType: isMobile ? 'x mandatory' : undefined,
        WebkitOverflowScrolling: isMobile ? 'touch' : undefined,
        margin: isMobile ? '0 -12px 16px' : '0 0 16px',
        padding: isMobile ? '0 12px 4px' : undefined,
      }}>
        {isAdmin && <>
          <StatCard value={clientes.length} label="Empresas cadastradas" accent="black" />
          <StatCard value={consultores.length} label="Consultores ativos" accent="gray" />
          <StatCard value={clientes.filter(c => c.consultor).length} label="Empresas atribuídas" accent="green" />
          <StatCard value={clientes.filter(c => !c.consultor).length} label="Sem responsável" accent="orange" />
        </>}
        {isClient && <>
          <StatCard
            value={empresaCliente?.status === 'ativo' ? 'Ativo' : 'Pendente'}
            label="Status da empresa principal"
            accent={empresaCliente?.status === 'ativo' ? 'green' : 'orange'}
          />

          <StatCard
            value={empresasCliente.length || 1}
            label={empresasCliente.length > 1 ? 'Empresas no grupo' : 'Empresa cadastrada'}
            accent="black"
          />

          <StatCard
            value={empresaCliente?.consultor || 'Não definido'}
            label="Consultor responsável"
            accent="gray"
          />

          <StatCard
            value="Manual"
            label="Envio da Coleta DICI"
            accent="orange"
          />
        </>}
      </div>
    )}

    {isClient && (
      <Card>
        <CardHead
          title="Visão geral de envios de planilhas"
          action={
            <Btn size="sm" variant="primary" onClick={() => onNav('planilhas')}>
              Ver planilhas
            </Btn>
          }
        />

        <div style={{
          padding: '16px',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr',
          gap: '14px',
        }}>
          <GraficoEnviosCliente
            isMobile={isMobile}
            carregando={carregandoPlanilhasDashboard}
            erro={erroPlanilhasDashboard}
            dados={graficoEnviosMensais}
            maiorValor={maiorEnvioMensal}
            totalEnvios={totalPlanilhasDashboard}
          />

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr',
            gap: '10px',
          }}>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '13px',
              background: '#fff',
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                Resumo operacional
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
              }}>
                <div style={{
                  padding: '10px',
                  borderRadius: '10px',
                  background: '#FAFAF8',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {totalLinhasDashboard}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    Linhas finais
                  </div>
                </div>

                <div style={{
                  padding: '10px',
                  borderRadius: '10px',
                  background: '#FAFAF8',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {totalDuplicidadesDashboard}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    Duplicidades
                  </div>
                </div>

                <div style={{
                  padding: '10px',
                  borderRadius: '10px',
                  background: '#FAFAF8',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {planilhasPendentesDashboard}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    Pendentes
                  </div>
                </div>

                <div style={{
                  padding: '10px',
                  borderRadius: '10px',
                  background: '#FAFAF8',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'var(--mono)' }}>
                    {totalIntegracoesConfiguradas}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)' }}>
                    Integrações
                  </div>
                </div>
              </div>
            </div>

            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--r-md)',
              padding: '13px',
              background: '#fff',
            }}>
              <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                Status das planilhas
              </div>

              <div style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '7px',
              }}>
                {resumoStatusPlanilhas.map(item => (
                  <div
                    key={item.status}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      padding: '8px 10px',
                      borderRadius: '10px',
                      background: '#FAFAF8',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <Pill label={item.label} color={item.color} />

                    <strong style={{
                      fontFamily: 'var(--mono)',
                      fontSize: '13px',
                    }}>
                      {item.total}
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{

        }}>
          <div style={{

          }}>
            <div style={{

            }}>



            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
              gap: '10px',
              padding: '12px',
            }}>
              {funcionalidadesFuturasDashboard.map(item => (
                <div
                  key={item.titulo}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    padding: '12px',
                    background: '#FEFCF9',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '8px',
                    alignItems: 'start',
                    marginBottom: '7px',
                  }}>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>
                      {item.titulo}
                    </div>

                    <Pill label={item.status} color="gray" />
                  </div>

                  <div style={{
                    fontSize: '12px',
                    color: 'var(--muted)',
                    lineHeight: 1.5,
                  }}>
                    {item.descricao}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>
    )}

    {isAdmin && <Card>
      <CardHead
        title="Empresas Cadastradas"
        action={
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
            <Btn size="sm" onClick={() => setMostrarFormCliente(true)}>
              + Novo cliente
            </Btn>
            <Btn size="sm" onClick={() => onNav('users')}>
              Gerenciar usuários
            </Btn>
          </div>
        }
      />
      {mostrarFormCliente && (
        <form
          onSubmit={cadastrarCliente}
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--border)',
            background: '#FAFAF8',
          }}
        >
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1.4fr 1fr 1.4fr 1fr 120px',
            gap: '9px',
            alignItems: 'end',
          }}>
            <div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                Nome do cliente *
              </div>
              <input
                value={novoCliente.nome}
                onChange={(e) => atualizarCampoNovoCliente('nome', e.target.value)}
                placeholder="Ex: Cliente Teste Telecom"
                style={{
                  width: '100%',
                  padding: '7px 9px',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontFamily: 'var(--font)',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                CNPJ *
              </div>
              <input
                value={novoCliente.cnpj}
                onChange={(e) => atualizarCampoNovoCliente('cnpj', e.target.value)}
                placeholder="00.000.000/0001-00"
                style={{
                  width: '100%',
                  padding: '7px 9px',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontFamily: 'var(--mono)',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                E-mail
              </div>
              <input
                type="email"
                value={novoCliente.email}
                onChange={(e) => atualizarCampoNovoCliente('email', e.target.value)}
                placeholder="cliente@email.com"
                style={{
                  width: '100%',
                  padding: '7px 9px',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontFamily: 'var(--font)',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                Consultor responsável
              </div>

              <select
                value={novoCliente.consultor}
                onChange={(e) => atualizarCampoNovoCliente('consultor', e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 9px',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontFamily: 'var(--font)',
                  outline: 'none',
                  background: '#fff',
                }}
              >
                <option value="">Selecione</option>
                {consultores.map(consultor => (
                  <option key={consultor.id} value={consultor.nome}>
                    {consultor.nome} — {consultor.email}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                Status
              </div>
              <select
                value={novoCliente.status}
                onChange={(e) => atualizarCampoNovoCliente('status', e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 9px',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontFamily: 'var(--font)',
                  outline: 'none',
                  background: '#fff',
                }}
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>

          {erroCadastroCliente && (
            <div style={{
              marginTop: '10px',
              padding: '8px 10px',
              borderRadius: '7px',
              background: '#FFF0F0',
              border: '1px solid #F5C6C6',
              color: 'var(--red)',
              fontSize: '12px',
            }}>
              {erroCadastroCliente}
            </div>
          )}

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '8px',
            marginTop: '12px',
          }}>
            <Btn
              type="button"
              size="sm"
              onClick={() => {
                setMostrarFormCliente(false);
                limparFormularioCliente();
              }}
            >
              Cancelar
            </Btn>

            <Btn
              type="submit"
              variant="primary"
              size="sm"
              disabled={salvandoCliente}
            >
              {salvandoCliente ? 'Salvando...' : 'Salvar cliente'}
            </Btn>
          </div>
        </form>
      )}
      <Tbl headers={['Empresa', 'CNPJ', 'E-mail', 'Consultor responsável', 'Status', 'Ações']}>
        {carregandoClientes && (
          <TR>
            <td colSpan={6} style={{
              padding: '12px 14px',
              borderBottom: '1px solid #F0EEE8',
              color: 'var(--muted)',
              textAlign: 'center'
            }}>
              Carregando clientes...
            </td>
          </TR>
        )}

        {erroClientes && (
          <TR>
            <td colSpan={6} style={{
              padding: '12px 14px',
              borderBottom: '1px solid #F0EEE8',
              color: 'var(--red)',
              textAlign: 'center'
            }}>
              {erroClientes}
            </td>
          </TR>
        )}

        {!carregandoClientes && !erroClientes && clientes.length === 0 && (
          <TR>
            <td colSpan={6} style={{
              padding: '12px 14px',
              borderBottom: '1px solid #F0EEE8',
              color: 'var(--muted)',
              textAlign: 'center'
            }}>
              Nenhum cliente cadastrado.
            </td>
          </TR>
        )}

        {!carregandoClientes && !erroClientes && clientes.map(c => {
          const col = coletas.find(cl => cl.cliente === c.nome || cl.clienteId === String(c.id));
          const st = col ? STATUS_MAP[col.status] : { label: 'Não iniciada', color: 'gray' };

          return (
            <TR key={c.id}>
              <TD>{c.nome}</TD>

              <TD mono>{c.cnpj || '—'}</TD>

              <TD>{c.email || '—'}</TD>

              <TD>
                <select
                  value={c.consultor || ''}
                  onChange={(e) => alterarConsultorDoCliente(c, e.target.value)}
                  style={{
                    width: '100%',
                    padding: '5px 7px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontFamily: 'var(--font)',
                    outline: 'none',
                    background: '#fff',
                  }}
                >
                  <option value="">Sem consultor</option>

                  {consultores.map(consultor => (
                    <option key={consultor.id} value={consultor.nome}>
                      {consultor.nome} — {consultor.email}
                    </option>
                  ))}
                </select>
              </TD>

              <TD>
                <Pill
                  label={c.status === 'ativo' ? 'Ativo' : 'Inativo'}
                  color={c.status === 'ativo' ? 'green' : 'gray'}
                />
              </TD>

              <TD>
                <ActBtn variant="view" title="Visualizar empresa">
                  ◉
                </ActBtn>

                <ActBtn variant="edit" title="Editar empresa">
                  ✎
                </ActBtn>

                <ActBtn
                  variant="del"
                  title="Excluir empresa"
                  onClick={() => excluirCliente(c)}
                >
                  ✕
                </ActBtn>
              </TD>
            </TR>
          );
        })}
      </Tbl></Card>}

    {isConsult && (
      <Card>
        <CardHead title="Meus clientes atribuídos pelo administrador" />

        <Tbl headers={['Cliente', 'CNPJ', 'E-mail', 'Status', 'Ações']}>
          {clientesDoConsultor.length === 0 && (
            <TR>
              <td colSpan={6} style={{
                padding: '12px 14px',
                borderBottom: '1px solid #F0EEE8',
                color: 'var(--muted)',
                textAlign: 'center'
              }}>
                Nenhum cliente atribuído a este consultor.
              </td>
            </TR>
          )}

          {clientesDoConsultor.map(cliente => (
            <TR key={cliente.id}>
              <TD>{cliente.nome}</TD>
              <TD mono>{cliente.cnpj}</TD>
              <TD>{cliente.email || '—'}</TD>
              <TD>
                <Pill
                  label={cliente.status === 'ativo' ? 'Ativo' : 'Inativo'}
                  color={cliente.status === 'ativo' ? 'green' : 'gray'}
                />
              </TD>
              <TD>
                <ActBtn variant="view" title="Visualizar cliente">◉</ActBtn>
                <ActBtn variant="dl" title="Baixar/consultar dados futuramente">⬇</ActBtn>
              </TD>
            </TR>
          ))}
        </Tbl>
      </Card>
    )}

    {isClient && (
      <>
        <Card>
          <CardHead
            title="Minha empresa"
            action={
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <Btn variant="primary" size="sm" onClick={() => onNav('dici')}>
                  Importar Coleta DICI
                </Btn>

                <Btn size="sm" onClick={() => onNav('docs')}>
                  Ver comprovantes
                </Btn>
              </div>
            }
          />

          {carregandoEmpresaCliente ? (
            <div style={{
              padding: '28px',
              textAlign: 'center',
              color: 'var(--muted)',
              fontSize: '13px'
            }}>
              Carregando dados da empresa...
            </div>
          ) : !empresaCliente ? (
            <div style={{
              padding: '28px',
              color: 'var(--muted)',
              fontSize: '13px',
              lineHeight: 1.5
            }}>
              Não encontramos uma empresa vinculada ao seu CNPJ.
              Entre em contato com a SCM para concluir o cadastro.
            </div>
          ) : (
            <div style={{ padding: '16px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr',
                gap: '12px',
                marginBottom: '14px'
              }}>
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '13px',
                  background: '#FAFAF8'
                }}>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                    Empresa
                  </div>

                  <div style={{ fontSize: '15px', fontWeight: 600 }}>
                    {empresaCliente.nome}
                  </div>

                  <div style={{
                    marginTop: '6px',
                    fontSize: '12px',
                    color: 'var(--muted)'
                  }}>
                    {empresaCliente.email || user?.email}
                  </div>
                </div>

                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '13px',
                  background: '#FAFAF8'
                }}>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                    CNPJ
                  </div>

                  <div style={{
                    fontSize: '15px',
                    fontWeight: 600,
                    fontFamily: 'var(--mono)'
                  }}>
                    {empresaCliente.cnpj || user?.cnpj || '—'}
                  </div>

                  <div style={{ marginTop: '7px' }}>
                    <Pill
                      label={empresaCliente.status === 'ativo' ? 'Empresa ativa' : 'Empresa inativa'}
                      color={empresaCliente.status === 'ativo' ? 'green' : 'gray'}
                    />
                  </div>
                </div>
              </div>


              <div style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                background: '#fff',
                marginBottom: '14px',
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '12px 14px',
                  borderBottom: '1px solid var(--border)',
                  background: '#FAFAF8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  flexWrap: 'wrap'
                }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>
                      Empresas cadastradas no grupo
                    </div>

                    <div style={{
                      fontSize: '12px',
                      color: 'var(--muted)',
                      marginTop: '3px'
                    }}>
                      Adicione outros CNPJs caso possua mais empresas no mesmo grupo.
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setMostrarFormEmpresaGrupo(prev => !prev);
                      setErroEmpresaGrupo('');
                    }}
                    style={{
                      padding: '8px 12px',
                      background: 'var(--orange)',
                      color: '#fff',
                      border: '1px solid var(--orange)',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {mostrarFormEmpresaGrupo ? 'Cancelar' : '+ Adicionar empresa'}
                  </button>
                </div>

                {mostrarFormEmpresaGrupo && (
                  <form
                    onSubmit={salvarEmpresaGrupo}
                    style={{
                      padding: '14px',
                      borderBottom: '1px solid var(--border)',
                      background: '#FFFDF9',
                    }}
                  >
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: isMobile ? '1fr' : '1.5fr 1fr auto',
                      gap: '9px',
                      alignItems: 'end',
                    }}>
                      <div>
                        <div style={{
                          fontSize: '11px',
                          color: 'var(--muted)',
                          marginBottom: '5px'
                        }}>
                          Nome da empresa
                        </div>

                        <input
                          type="text"
                          value={novaEmpresaGrupo.nome}
                          onChange={(e) => atualizarNovaEmpresaGrupo('nome', e.target.value)}
                          placeholder="Ex: Nova Empresa Telecom LTDA"
                          style={{
                            width: '100%',
                            padding: '9px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: '9px',
                            fontSize: '12px',
                            fontFamily: 'var(--font)',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>

                      <div>
                        <div style={{
                          fontSize: '11px',
                          color: 'var(--muted)',
                          marginBottom: '5px'
                        }}>
                          CNPJ
                        </div>

                        <input
                          type="text"
                          value={novaEmpresaGrupo.cnpj}
                          onChange={(e) => atualizarNovaEmpresaGrupo('cnpj', e.target.value)}
                          placeholder="00.000.000/0001-00"
                          maxLength={18}
                          inputMode="numeric"
                          style={{
                            width: '100%',
                            padding: '9px 10px',
                            border: '1px solid var(--border)',
                            borderRadius: '9px',
                            fontSize: '12px',
                            fontFamily: 'var(--mono)',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={salvandoEmpresaGrupo}
                        style={{
                          padding: '10px 14px',
                          background: 'var(--admin-bg)',
                          color: '#fff',
                          border: '1px solid var(--admin-bg)',
                          borderRadius: '9px',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: salvandoEmpresaGrupo ? 'not-allowed' : 'pointer',
                          opacity: salvandoEmpresaGrupo ? 0.7 : 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {salvandoEmpresaGrupo ? 'Salvando...' : 'Salvar'}
                      </button>
                    </div>

                    {erroEmpresaGrupo && (
                      <div style={{
                        marginTop: '10px',
                        padding: '9px 10px',
                        borderRadius: '9px',
                        background: '#FFF0F0',
                        border: '1px solid #F5C6C6',
                        color: 'var(--red)',
                        fontSize: '12px',
                      }}>
                        {erroEmpresaGrupo}
                      </div>
                    )}
                  </form>
                )}

                <Tbl headers={['Empresa', 'CNPJ', 'Tipo', 'Status']}>
                  {empresasCliente.map(empresa => (
                    <TR key={empresa.id}>
                      <TD>
                        <div style={{ fontWeight: 600 }}>
                          {empresa.nome}
                        </div>

                        {empresa.grupo_nome && (
                          <div style={{
                            fontSize: '11px',
                            color: 'var(--muted)',
                            marginTop: '2px'
                          }}>
                            Grupo: {empresa.grupo_nome}
                          </div>
                        )}
                      </TD>

                      <TD mono>
                        {formatarCnpj(empresa.cnpj || '') || '—'}
                      </TD>

                      <TD>
                        <Pill
                          label={empresa.empresa_principal ? 'Principal' : 'Empresa do grupo'}
                          color={empresa.empresa_principal ? 'orange' : 'gray'}
                        />
                      </TD>

                      <TD>
                        <Pill
                          label={empresa.status === 'ativo' ? 'Ativa' : 'Inativa'}
                          color={empresa.status === 'ativo' ? 'green' : 'gray'}
                        />
                      </TD>
                    </TR>
                  ))}
                </Tbl>
              </div>

              <div style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)',
                padding: '13px',
                background: '#fff',
                marginBottom: '14px'
              }}>
                <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '4px' }}>
                  Consultor responsável
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px'
                }}>
                  <div>
                    <div style={{ fontSize: '14px', fontWeight: 600 }}>
                      {empresaCliente.consultor || 'Ainda não definido'}
                    </div>

                    <div style={{
                      fontSize: '12px',
                      color: 'var(--muted)',
                      marginTop: '3px'
                    }}>
                      O consultor responsável é definido pela equipe administrativa da SCM.
                    </div>
                  </div>

                  <Pill
                    label={empresaCliente.consultor ? 'Atribuído' : 'Aguardando'}
                    color={empresaCliente.consultor ? 'green' : 'orange'}
                  />
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
                gap: '12px'
              }}>
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '13px',
                  background: '#FFF4EC'
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '5px' }}>
                    Coleta DICI
                  </div>

                  <div style={{
                    fontSize: '12px',
                    color: 'var(--muted)',
                    lineHeight: 1.5,
                    marginBottom: '10px'
                  }}>
                    Importe sua planilha em XLSX ou CSV para o portal validar, remover duplicidades e gerar o CSV final.
                  </div>

                  <Btn variant="primary" size="sm" onClick={() => onNav('dici')}>
                    Acessar Coleta DICI
                  </Btn>
                </div>

                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--r-md)',
                  padding: '13px',
                  background: '#FAFAF8'
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '5px' }}>
                    Comprovantes
                  </div>

                  <div style={{
                    fontSize: '12px',
                    color: 'var(--muted)',
                    lineHeight: 1.5,
                    marginBottom: '10px'
                  }}>
                    Acompanhe os comprovantes anexados pela equipe SCM para sua empresa.
                  </div>

                  <Btn size="sm" onClick={() => onNav('docs')}>
                    Ver comprovantes
                  </Btn>
                </div>
              </div>
            </div>
          )}
        </Card>
      </>
    )}

  </div>;
}

/* ==============================
   COLETA DICI
   ============================== */
function ViewDICI() {
  const { user, isClient, isConsult, isAdmin } = useAuth();
  // Conversor DICI disponível para clientes e consultores (importar, corrigir e baixar o CSV).
  const modoConversor = isClient || isConsult;
  const fileRef = React.useRef(null);
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState([]);
  const [filtro, setFiltro] = useState('');
  const [clienteSel, setClienteSel] = useState('Severino Ramilio — Jan/26');
  const [arquivoImportado, setArquivoImportado] = useState(null);
  const [planilhaAtualId, setPlanilhaAtualId] = useState(null);
  const [salvandoColeta, setSalvandoColeta] = useState(false);
  const [problemasImportacao, setProblemasImportacao] = useState([]);

  const [duplicidadesInfo, setDuplicidadesInfo] = useState({ originais: 0, finais: 0, unificadas: 0 });
  const [historico, setHistorico] = useState([
    { dt: '—', acao: 'Aguardando importação', user: 'Portal Cliente', detalhe: 'Importe uma planilha .xlsx, .csv e .ods para gerar o CSV da coleta SCM sem duplicidade.' }
  ]);
  const tabs = ['Dados importados', 'Mapeamento de colunas', 'Histórico'];
  const CSV_HEADERS = ['CNPJ', 'ANO', 'MES', 'COD_IBGE', 'TIPO_CLIENTE', 'TIPO_ATENDIMENTO', 'TIPO_MEIO', 'TIPO_PRODUTO', 'TIPO_TECNOLOGIA', 'VELOCIDADE', 'ACESSOS'];
  const HEADER_LABELS = {
    CNPJ: 'CNPJ', ANO: 'Ano', MES: 'Mês', COD_IBGE: 'Cód. IBGE', TIPO_CLIENTE: 'Cliente',
    TIPO_ATENDIMENTO: 'Atend.', TIPO_MEIO: 'Meio', TIPO_PRODUTO: 'Produto', TIPO_TECNOLOGIA: 'Tecnologia',
    VELOCIDADE: 'Velocidade', ACESSOS: 'Acessos'
  };

  const normalizar = (v) => String(v ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  const aliasCampo = (v) => {
    const n = normalizar(v);
    const aliases = {
      CNPJ: ['CNPJ', 'CNPJ_EMPRESA'], ANO: ['ANO', 'ANO_REFERENCIA'], MES: ['MES', 'MES_REFERENCIA', 'MES_REF'],
      COD_IBGE: ['COD_IBGE', 'CODIGO_IBGE', 'IBGE', 'MUNICIPIO_IBGE', 'CODIGO_IBGE_MUNICIPIO_QUE_ATENDE_APENAS_7_NUMEROS'], TIPO_CLIENTE: ['TIPO_CLIENTE', 'TIPO_DE_CLIENTE', 'CLIENTE', 'PF_PJ'],
      TIPO_ATENDIMENTO: ['TIPO_ATENDIMENTO', 'TIPO_DE_ATENDIMENTO', 'ATENDIMENTO'], TIPO_MEIO: ['TIPO_MEIO', 'TIPO_DE_MEIO_DE_ACESSO', 'MEIO'],
      TIPO_PRODUTO: ['TIPO_PRODUTO', 'TIPO_DE_PRODUTO', 'PRODUTO'], TIPO_TECNOLOGIA: ['TIPO_TECNOLOGIA', 'TECNOLOGIA'],
      VELOCIDADE: ['VELOCIDADE', 'VELOCIDADE_CONTRATADA', 'VELOCIDADE_MBPS'], ACESSOS: ['ACESSOS', 'QUANTIDADE_DE_ACESSOS', 'QT_ACESSOS', 'QTD_ACESSOS']
    };
    return Object.keys(aliases).find(k => aliases[k].some(a => n === a || n.startsWith(a + '_') || n.includes(a))) || null;
  };

  const limparCNPJ = (v) => String(v ?? '').replace(/\D/g, '').padStart(14, '0').slice(-14);
  const valorCelula = (v) => String(v ?? '').trim();

  const VALORES_INVALIDOS_DICI = [
    'NULO',
    'NULL',
    'N/A',
    'NA',
    'NAN',
    '-',
    '--'
  ];

  const ehValorInvalidoDici = (valor) => {
    const texto = normalizar(valor);

    return texto !== '' && VALORES_INVALIDOS_DICI.includes(texto);
  };

  const campoObrigatorioValido = (valor) => {
    const texto = String(valor ?? '').trim();

    return texto !== '' && !ehValorInvalidoDici(texto);
  };

  const validarLinhaDici = (linha) => {
    return CSV_HEADERS.every(campo => campoObrigatorioValido(linha[campo]));
  };

  const obterProblemasLinha = (linha) => {
    return CSV_HEADERS
      .filter(campo => !campoObrigatorioValido(linha[campo]))
      .map(campo => ({
        linha: linha._linhaOrigem || '—',
        campo,
        valor: linha[campo] || 'vazio',
      }));
  };

  const montarProblemasImportacao = (dados) => {
    return dados.flatMap(linha => obterProblemasLinha(linha));
  };
  const localizarTabela = (linhas) => {
    for (let i = 0; i < linhas.length; i++) {
      const mapa = {};
      linhas[i].forEach((cel, idx) => {
        const campo = aliasCampo(cel);
        if (campo && mapa[campo] === undefined) mapa[campo] = idx;
      });
      if (CSV_HEADERS.filter(h => mapa[h] !== undefined).length >= 5) return { headerIndex: i, mapa };
    }
    return null;
  };

  const excelSerialParaData = (serial) => {
    const n = Number(serial);
    if (!Number.isFinite(n) || n < 20000) return null;
    return new Date(Math.round((n - 25569) * 86400 * 1000));
  };

  const extrairAnoMes = (valor, nomeArquivo = '') => {
    const s = String(valor ?? '').trim();
    const dataSerial = excelSerialParaData(s);
    if (dataSerial) return { ano: String(dataSerial.getUTCFullYear()), mes: String(dataSerial.getUTCMonth() + 1) };
    let m = s.match(/(\d{1,2})[\/\-](\d{4})/);
    if (m) return { ano: m[2], mes: String(Number(m[1])) };
    m = s.match(/(\d{4})[\/\-](\d{1,2})/);
    if (m) return { ano: m[1], mes: String(Number(m[2])) };
    m = nomeArquivo.match(/(\d{2})(\d{4})/);
    if (m) return { ano: m[2], mes: String(Number(m[1])) };
    return { ano: '', mes: '' };
  };

  const extrairMetadados = (linhas, nomeArquivo) => {
    let cnpj = '', ref = '';
    for (let r = 0; r < linhas.length; r++) {
      for (let c = 0; c < (linhas[r]?.length || 0); c++) {
        const n = normalizar(linhas[r][c]);
        if (n === 'CNPJ' && !cnpj) {
          for (let rr = r + 1; rr <= Math.min(r + 3, linhas.length - 1); rr++) {
            const v = linhas[rr]?.[c];
            if (String(v ?? '').replace(/\D/g, '').length >= 8) { cnpj = limparCNPJ(v); break; }
          }
        }
        if ((n === 'MES_REFERENCIA' || n === 'MES_REF') && !ref) {
          for (let rr = r + 1; rr <= Math.min(r + 3, linhas.length - 1); rr++) {
            const v = linhas[rr]?.[c];
            if (v !== undefined && v !== '') { ref = v; break; }
          }
        }
      }
    }
    const am = extrairAnoMes(ref, nomeArquivo);
    return { cnpj, ano: am.ano, mes: am.mes };
  };


  const padronizarTecnologia = (valor) => {
    const texto = String(valor ?? '').trim();

    if (!texto) return '';

    const normalizado = texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/\s+/g, '')
      .replace(/_/g, '-');

    if (
      normalizado === 'WI-FI' ||
      normalizado === 'WIFI' ||
      normalizado === 'WI FI' ||
      normalizado === 'Wi-fi'
    ) {
      return 'Wi-Fi';
    }

    return texto.toUpperCase();
  };

  const ajustarValorCampo = (campo, valor, meta = {}) => {
    let v = valorCelula(valor);

    if (ehValorInvalidoDici(v)) {
      return '';
    }

    if (['COD_IBGE', 'ACESSOS'].includes(campo)) {
      v = inteiroTexto(v);
    }

    if (campo === 'VELOCIDADE') {
      v = normalizarVelocidade(v);
    }

    if (campo === 'CNPJ') {
      v = v ? limparCNPJ(v) : meta.cnpj;
    }

    if (campo === 'ANO') {
      v = v || meta.ano;
    }

    if (campo === 'MES') {
      v = v || meta.mes;
    }

    if (campo === 'TIPO_MEIO' || campo === 'TIPO_PRODUTO') {
      v = v.toLowerCase();
    }

    if (campo === 'TIPO_CLIENTE' || campo === 'TIPO_ATENDIMENTO') {
      v = v.toUpperCase();
    }

    if (campo === 'TIPO_TECNOLOGIA') {
      v = padronizarTecnologia(v);
    }

    return v;
  };

  const linhasParaObjetos = (linhas, info, meta) => linhas.slice(info.headerIndex + 1)
    .map((linha, idx) => {
      const obj = {
        id: 'imp_' + Date.now() + '_' + idx,
        _linhaOrigem: info.headerIndex + 2 + idx,
      };

      CSV_HEADERS.forEach(h => {
        obj[h] = ajustarValorCampo(h, linha[info.mapa[h]], meta);
      });

      obj.ok = validarLinhaDici(obj);
      obj._problemas = obterProblemasLinha(obj);

      return obj;
    })
    .filter(obj => String(obj.COD_IBGE ?? '').trim() !== '');

  const CHAVE_DUPLICIDADE = CSV_HEADERS.filter(h => h !== 'ACESSOS');

  const aplicarRegraDuplicidade = (dados) => {
    const mapa = new Map();
    let unificadas = 0;

    dados.forEach((linha) => {
      const linhaValida = validarLinhaDici(linha);

      // Linha inválida não deve ser somada com outra,
      // porque ainda falta o cliente corrigir o campo.
      const chave = linhaValida
        ? CHAVE_DUPLICIDADE.map(h => String(linha[h] ?? '').trim()).join('|')
        : 'INVALIDA|' + (linha.id || Math.random());

      if (!mapa.has(chave)) {
        mapa.set(chave, {
          ...linha,
          ACESSOS: String(Number(linha.ACESSOS) || 0),
        });
      } else {
        const atual = mapa.get(chave);

        atual.ACESSOS = String(
          (Number(atual.ACESSOS) || 0) + (Number(linha.ACESSOS) || 0)
        );

        atual.ok = validarLinhaDici(atual);
        atual._problemas = obterProblemasLinha(atual);

        unificadas++;
      }
    });

    const finais = Array.from(mapa.values()).map((r, idx) => {
      const linhaFinal = {
        ...r,
        id: 'row_' + Date.now() + '_' + idx,
      };

      linhaFinal.ok = validarLinhaDici(linhaFinal);
      linhaFinal._problemas = obterProblemasLinha(linhaFinal);

      return linhaFinal;
    });

    return {
      dados: finais,
      info: {
        originais: dados.length,
        finais: finais.length,
        unificadas,
      },
    };
  };

  const splitLinhaCsv = (linha, sep = ';') => {
    const out = []; let atual = ''; let aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const ch = linha[i];
      if (ch === '"' && linha[i + 1] === '"') { atual += '"'; i++; continue; }
      if (ch === '"') { aspas = !aspas; continue; }
      if (ch === sep && !aspas) { out.push(atual); atual = ''; continue; }
      atual += ch;
    }
    out.push(atual);
    return out;
  };

  const linhasCsvParaObjetos = (texto, nomeArquivo) => {
    const limpo = texto.replace(/^\uFEFF/, '');
    const linhas = limpo.split(/\r?\n/).filter(l => l.trim() !== '');

    if (!linhas.length) return [];

    const sep = linhas[0].includes(';') ? ';' : ',';
    const primeira = splitLinhaCsv(linhas[0], sep);

    const mapa = {};

    primeira.forEach((h, idx) => {
      const campo = aliasCampo(h);
      if (campo) mapa[campo] = idx;
    });

    const temCabecalho = CSV_HEADERS.filter(h => mapa[h] !== undefined).length >= 5;

    const meta = {
      cnpj: '',
      ...extrairAnoMes('', nomeArquivo),
    };

    return linhas.slice(temCabecalho ? 1 : 0)
      .map((linha, idx) => {
        const cols = splitLinhaCsv(linha, sep);

        const obj = {
          id: 'csv_' + Date.now() + '_' + idx,
          _linhaOrigem: (temCabecalho ? 2 : 1) + idx,
        };

        if (temCabecalho) {
          CSV_HEADERS.forEach(h => {
            obj[h] = ajustarValorCampo(h, cols[mapa[h]], meta);
          });
        } else {
          CSV_HEADERS.forEach((h, i) => {
            obj[h] = ajustarValorCampo(h, cols[i], meta);
          });
        }

        obj.ok = validarLinhaDici(obj);
        obj._problemas = obterProblemasLinha(obj);

        return obj;
      })
      .filter(obj => String(obj.COD_IBGE ?? '').trim() !== '');
  };

  const competenciaTexto = (dados) => {
    const r = dados[0] || {};
    const meses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const mes = Number(r.MES);
    return (meses[mes] || r.MES || '—') + '/' + (r.ANO || '—');
  };

  const salvarPlanilhaNoHistorico = (registro) => {
    try {
      const chave = 'scm_planilhas_cliente';
      const atuais = JSON.parse(localStorage.getItem(chave) || '[]');
      localStorage.setItem(chave, JSON.stringify([registro, ...atuais].slice(0, 50)));
    } catch (e) { console.warn('Não foi possível salvar histórico local.', e); }
  };

  const importarXlsx = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();

    if (!['xlsx', 'xls', 'csv', 'ods'].includes(ext)) {
      alert('Selecione uma planilha no formato .xlsx, .xls, .csv ou .ods');
      event.target.value = '';
      return;
    }

    if ((ext === 'xlsx' || ext === 'xls' || ext === 'ods') && !window.XLSX) {
      alert('Biblioteca XLSX não carregada. Verifique a conexão com a internet e recarregue a página.');
      event.target.value = '';
      return;
    }

    try {
      let resultado = null;

      if (ext === 'csv') {
        const texto = await file.text();
        const dadosCsv = linhasCsvParaObjetos(texto, file.name);

        if (dadosCsv.length) {
          resultado = {
            nomeAba: 'CSV',
            dados: dadosCsv,
            tipo: 'CSV',
          };
        }
      } else {
        const buffer = await file.arrayBuffer();

        const workbook = XLSX.read(buffer, {
          type: 'array',
        });

        for (const nomeAba of workbook.SheetNames) {
          const aba = workbook.Sheets[nomeAba];

          const linhas = XLSX.utils.sheet_to_json(aba, {
            header: 1,
            defval: '',
            raw: true,
          });

          const infoTabela = localizarTabela(linhas);

          if (infoTabela) {
            const meta = extrairMetadados(linhas, file.name);
            const dadosAba = linhasParaObjetos(linhas, infoTabela, meta);

            if (dadosAba.length) {
              resultado = {
                nomeAba,
                dados: dadosAba,
                tipo: ext === 'ods' ? 'ODS' : 'XLSX',
              };

              break;
            }
          }
        }
      }

      if (!resultado) {
        alert('Não encontrei dados DICI válidos no arquivo. O arquivo precisa conter COD_IBGE e as colunas da coleta.');
        return;
      }

      const { dados, info } = aplicarRegraDuplicidade(resultado.dados);

      const problemas = montarProblemasImportacao(dados);
      setProblemasImportacao(problemas);

      if (problemas.length > 0) {
        const exemplos = problemas
          .slice(0, 5)
          .map(p => `Linha ${p.linha}: ${HEADER_LABELS[p.campo] || p.campo}`)
          .join('\n');

        alert(
          `A planilha possui ${problemas.length} campo(s) inválido(s) ou vazio(s).\n\n` +
          `Exemplos:\n${exemplos}\n\n` +
          `Corrija os campos antes de baixar ou salvar a coleta. Valores como NULO, NULL e N/A não são aceitos.`
        );
      }

      setRows(dados);
      setDuplicidadesInfo(info);

      const competencia = competenciaTexto(dados);

      setArquivoImportado({
        nome: file.name,
        aba: resultado.nomeAba,
        tipo: resultado.tipo,
        total: dados.length,
        competencia,
      });

      salvarPlanilhaNoHistorico({
        id: 'pl_' + Date.now(),
        nome: file.name,
        tipo: resultado.tipo,
        competencia,
        totalOriginal: info.originais,
        totalFinal: info.finais,
        duplicidades: info.unificadas,
        importadoEm: new Date().toLocaleString('pt-BR'),
        status: 'Importada',
        rows: dados,
      });

      try {
        const primeiraLinha = dados[0] || {};

        const competenciaAno = Number(primeiraLinha.ANO) || new Date().getFullYear();
        const competenciaMes = Number(primeiraLinha.MES) || (new Date().getMonth() + 1);

        const nomeArquivoFinal = montarNomeArquivoPadrao({
          ano: primeiraLinha.ANO,
          mes: primeiraLinha.MES,
          competencia,
          empresa: user?.name || user?.nome || 'EMPRESA',
        });

        const cnpjFinal = normalizarCnpj(primeiraLinha.CNPJ || user?.cnpj);

        const { data: planilhaSalva, error } = await supabase
          .from('planilhas_coleta')
          .insert({
            usuario_id: user?.id || null,

            cnpj: cnpjFinal || null,
            cliente_nome: user?.name || user?.nome || '',

            competencia,
            competencia_ano: competenciaAno,
            competencia_mes: competenciaMes,

            nome_arquivo: file.name,
            nome_arquivo_original: file.name,
            nome_arquivo_final: nomeArquivoFinal,

            tipo_arquivo: resultado.tipo,
            total_original: info.originais,
            total_final: info.finais,
            duplicidades: info.unificadas,

            dados_json: dados,
            status: 'recebido',
          })
          .select()
          .single();

        if (error) {
          throw error;
        }

        setPlanilhaAtualId(planilhaSalva.id);
      } catch (error) {
        console.error('Erro ao salvar planilha no Supabase:', error);
        alert(error.message || 'A planilha foi importada na tela, mas não foi salva no Supabase.');
      }

      setHistorico(prev => [{
        dt: new Date().toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        acao: 'Importação ' + resultado.tipo,
        user: 'Portal Cliente',
        detalhe: file.name + ' importado com ' + info.originais + ' linha(s); ' + info.unificadas + ' duplicidade(s) somada(s); saída final com ' + info.finais + ' linha(s).',
      }, ...prev.filter(h => h.acao !== 'Aguardando importação')]);

      setTab(0);
    } catch (err) {
      console.error(err);
      alert('Não foi possível ler o arquivo. Confira se a planilha não está corrompida ou protegida.');
    } finally {
      event.target.value = '';
    }
  };

  const csvEscape = (v) => {
    const s = String(v ?? '').replace(/\r?\n/g, ' ').trim();
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const prepararLinhasParaSaida = () => {
    const problemas = montarProblemasImportacao(rows);

    setProblemasImportacao(problemas);

    if (problemas.length > 0) {
      const exemplos = problemas
        .slice(0, 5)
        .map(p => `Linha ${p.linha}: ${HEADER_LABELS[p.campo] || p.campo}`)
        .join('\n');

      alert(
        `Não é possível salvar ou baixar a coleta ainda.\n\n` +
        `Existem ${problemas.length} campo(s) inválido(s) ou vazio(s).\n\n` +
        `Exemplos:\n${exemplos}\n\n` +
        `Corrija antes de continuar. Valores como NULO, NULL e N/A não são aceitos.`
      );

      return null;
    }

    const resultado = aplicarRegraDuplicidade(rows);

    setRows(resultado.dados);
    setDuplicidadesInfo(resultado.info);

    return resultado;
  };
  const salvarColetaAtual = async () => {
    if (!rows.length) {
      alert('Importe uma planilha antes de salvar.');
      return;
    }

    if (!planilhaAtualId) {
      alert('Essa coleta ainda não possui vínculo salvo. Importe a planilha novamente para gerar o registro no Supabase.');
      return;
    }

    const preparado = prepararLinhasParaSaida();

    if (!preparado) return;

    const linhasFinais = preparado.dados;
    const infoFinal = preparado.info;

    try {
      setSalvandoColeta(true);

      const { error } = await supabase
        .from('planilhas_coleta')
        .update({
          dados_json: linhasFinais,
          total_final: linhasFinais.length,
          duplicidades: infoFinal.unificadas,
          atualizado_em: new Date().toISOString(),
          status: 'recebido',
        })
        .eq('id', planilhaAtualId);

      if (error) {
        throw error;
      }

      alert('Coleta salva com sucesso!');
    } catch (error) {
      console.error('Erro ao salvar coleta:', error);
      alert(error.message || 'Não foi possível salvar a coleta no Supabase.');
    } finally {
      setSalvandoColeta(false);
    }
  };
  const exportCSV = () => {
    if (!rows.length) {
      alert('Importe uma planilha .xlsx, .csv ou .ods antes de baixar o CSV.');
      return;
    }

    const preparado = prepararLinhasParaSaida();

    if (!preparado) return;

    const linhasFinais = preparado.dados;

    const header = CSV_HEADERS.join(';');

    const body = linhasFinais
      .map(r => CSV_HEADERS.map(h => csvEscape(r[h])).join(';'))
      .join('\r\n');

    const conteudo = '\uFEFF' + header + '\r\n' + body;

    const a = document.createElement('a');

    a.href = URL.createObjectURL(
      new Blob([conteudo], {
        type: 'text/csv;charset=utf-8;',
      })
    );

    const primeiraLinha = linhasFinais[0] || {};

    a.download = montarNomeArquivoPadrao({
      ano: primeiraLinha.ANO,
      mes: primeiraLinha.MES,
      competencia: arquivoImportado?.competencia,
      empresa: user?.name || user?.nome || 'EMPRESA',
    });

    a.click();

    URL.revokeObjectURL(a.href);

    setHistorico(prev => [{
      dt: new Date().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      acao: 'Download CSV',
      user: 'Portal Cliente',
      detalhe: 'CSV UTF-8 com BOM e CRLF gerado com ' + linhasFinais.length + ' linha(s), já sem duplicidade.',
    }, ...prev]);
  };

  const upd = (id, field, val) => setRows(prev => prev.map(r => {
    if (r.id !== id) return r;

    let valorFinal = val;

    if (ehValorInvalidoDici(valorFinal)) {
      valorFinal = '';
    }

    if (field === 'CNPJ') {
      valorFinal = limparCNPJ(valorFinal);
    }

    if (field === 'VELOCIDADE') {
      valorFinal = normalizarVelocidade(valorFinal);
    }

    if (field === 'TIPO_TECNOLOGIA') {
      valorFinal = padronizarTecnologia(valorFinal);
    }

    const u = {
      ...r,
      [field]: valorFinal,
    };

    u.ok = validarLinhaDici(u);
    u._problemas = obterProblemasLinha(u);

    return u;
  }));
  const del = (id) => setRows(prev => prev.filter(r => r.id !== id));
  const add = () => setRows(prev => [...prev, { id: 'manual_' + Date.now(), CNPJ: '', ANO: '2026', MES: '1', COD_IBGE: '', TIPO_CLIENTE: 'PF', TIPO_ATENDIMENTO: 'URBANO', TIPO_MEIO: 'fibra', TIPO_PRODUTO: 'internet', TIPO_TECNOLOGIA: 'FTTH', VELOCIDADE: '', ACESSOS: '', ok: false }]);
  const pendentes = rows.filter(r => !r.ok).length;
  const filtrados = rows.filter(r => !filtro || CSV_HEADERS.some(h => String(r[h]).toLowerCase().includes(filtro.toLowerCase())));

  const EditCell = ({ id, field, val, w, mono }) => {
    const [v, sv] = useState(val ?? '');
    React.useEffect(() => sv(val ?? ''), [val]);
    const [foc, sf] = useState(false);
    const missing = !v;
    return <input value={v} onChange={e => { sv(e.target.value); upd(id, field, e.target.value); }}
      onFocus={() => sf(true)} onBlur={() => sf(false)}
      style={{
        border: `1px solid ${foc ? 'var(--orange)' : missing ? '#F5C6C6' : 'transparent'}`,
        borderRadius: '4px', padding: '2px 6px', fontSize: '12px',
        fontFamily: mono ? 'var(--mono)' : 'var(--font)',
        background: missing ? '#FFF8F8' : 'transparent', width: w || '100%', outline: 'none'
      }} />;
  };

  return <div>
    <input
      ref={fileRef}
      type="file"
      accept=".xlsx,.xls,.csv,.ods,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.oasis.opendocument.spreadsheet"
      onChange={importarXlsx}
      style={{ display: 'none' }}
    />

    {modoConversor && <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '13px 15px', marginBottom: '13px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', justifyContent: 'space-between' }}>
      <div style={{ flex: '1 1 240px', minWidth: 0 }}>
        <div style={{ fontSize: '13px', fontWeight: 500 }}>Importar planilha DICI em XLSX, CSV ou ODS</div>
        <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '3px' }}>
          {arquivoImportado ? <>Arquivo: <strong>{arquivoImportado.nome}</strong> · {arquivoImportado.tipo} · Competência: <strong>{arquivoImportado.competencia}</strong> · {arquivoImportado.total} linhas finais</> : 'O CSV final é gerado em UTF-8 com BOM, CRLF e sem duplicidade.'}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        <Btn variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
          ⬆ Importar XLSX/CSV/ODS
        </Btn>

        <Btn
          variant="primary"
          size="sm"
          onClick={salvarColetaAtual}
          disabled={!rows.length || salvandoColeta}
        >
          {salvandoColeta ? 'Salvando...' : '💾 Salvar coleta'}
        </Btn>

        <Btn variant="dark" size="sm" onClick={exportCSV}>
          ⬇ Baixar CSV
        </Btn>

      </div>
    </div>}

    {rows.length > 0 && modoConversor && <div style={{ background: '#E6F3FF', border: '1px solid #B8DBF5', borderRadius: 'var(--r-md)', padding: '9px 13px', fontSize: '12px', color: '#0F6FA8', marginBottom: '13px' }}>
      Regra aplicada: duplicidade é quando todos os campos são iguais, exceto <strong>ACESSOS</strong>. Nesses casos, os acessos são somados. Linhas originais: <strong>{duplicidadesInfo.originais}</strong> · duplicidades somadas: <strong>{duplicidadesInfo.unificadas}</strong> · linhas finais: <strong>{duplicidadesInfo.finais}</strong>.
    </div>}
    {problemasImportacao.length > 0 && modoConversor && (
      <div style={{
        background: '#FFF0F0',
        border: '1px solid #F5C6C6',
        borderRadius: 'var(--r-md)',
        padding: '10px 13px',
        fontSize: '12px',
        color: 'var(--red)',
        marginBottom: '13px',
        lineHeight: 1.5,
      }}>
        ⚠ <strong>Planilha com campos inválidos.</strong><br />
        Valores como <strong>NULO</strong>, <strong>NULL</strong> e <strong>N/A</strong> não são aceitos na Coleta DICI.

        <div style={{ marginTop: '6px' }}>
          {problemasImportacao.slice(0, 5).map((p, idx) => (
            <div key={idx}>
              Linha {p.linha} · {HEADER_LABELS[p.campo] || p.campo}: {String(p.valor || 'vazio')}
            </div>
          ))}

          {problemasImportacao.length > 5 && (
            <div>
              ...e mais {problemasImportacao.length - 5} pendência(s).
            </div>
          )}
        </div>
      </div>
    )}
    {pendentes > 0 && modoConversor && <div style={{
      background: 'var(--orange-pale)', border: '1px solid #F5C9A0',
      borderRadius: 'var(--r-md)', padding: '9px 13px', fontSize: '12px', color: 'var(--orange-d)',
      marginBottom: '13px', display: 'flex', alignItems: 'center', gap: '7px'
    }}>
      ⚠ <strong>{pendentes} {pendentes === 1 ? 'linha com campo' : 'linhas com campos'} vazio</strong> — preencha antes de baixar o CSV final
    </div>}

    {isAdmin && <div style={{
      background: '#EBEBED', border: '1px solid #D0D0D3',
      borderRadius: 'var(--r-md)', padding: '9px 13px', fontSize: '12px', color: '#555',
      marginBottom: '13px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px'
    }}>
      <span>📋 Modo visualização — dados do cliente. Baixe para lançar na Anatel.</span>

    </div>}

    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: '15px' }}>
      {tabs.map((t, i) => <div key={i} onClick={() => setTab(i)} style={{
        padding: '8px 15px', fontSize: '13px', cursor: 'pointer', fontWeight: tab === i ? 500 : 400,
        color: tab === i ? 'var(--orange)' : 'var(--muted)',
        borderBottom: tab === i ? '2px solid var(--orange)' : '2px solid transparent', marginBottom: '-1px'
      }}>{t}</div>)}
    </div>

    {tab === 0 && <Card>
      <CardHead title={modoConversor ? (isClient ? 'Minha coleta DICI — ' : 'Conversor DICI — ') + (rows.length || 0) + ' registros finais' : 'Coletas enviadas'}
        action={<div style={{ display: 'flex', gap: '7px', alignItems: 'center' }}>
          <input value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar..."
            style={{
              padding: '5px 10px', border: '1px solid var(--border)', borderRadius: '6px',
              fontSize: '12px', width: '170px', outline: 'none', fontFamily: 'var(--font)'
            }} />
          {!modoConversor && <Btn variant="primary" size="sm" onClick={exportCSV}>⬇ Baixar planilha</Btn>}
        </div>} />
      {rows.length === 0 ? <div style={{ padding: '34px', textAlign: 'center', color: 'var(--muted)', fontSize: '13px' }}>
        Nenhuma planilha importada ainda. Clique em <strong>Importar XLSX/CSV/ODS</strong> para carregar os dados da coleta.
      </div> : <Tbl headers={['#', ...CSV_HEADERS.map(h => HEADER_LABELS[h]), 'Status', '']}>
        {filtrados.map((r, i) => <TR key={r.id}>
          <TD mono style={{ color: 'var(--faint)', fontSize: '11px', width: 32 }}>{i + 1}</TD>
          {CSV_HEADERS.map(h => <TD key={h}>{modoConversor
            ? <EditCell id={r.id} field={h} val={r[h]} w={h === 'CNPJ' ? 118 : h === 'TIPO_TECNOLOGIA' ? 86 : h === 'TIPO_ATENDIMENTO' ? 78 : 72} mono={['CNPJ', 'ANO', 'MES', 'COD_IBGE', 'VELOCIDADE', 'ACESSOS'].includes(h)} />
            : <span style={{ fontFamily: ['CNPJ', 'ANO', 'MES', 'COD_IBGE', 'VELOCIDADE', 'ACESSOS'].includes(h) ? 'var(--mono)' : undefined, fontSize: '12px' }}>{r[h] || <span style={{ color: 'var(--red)' }}>—</span>}</span>}
          </TD>)}
          <TD><Pill label={r.ok ? 'OK' : 'Pendente'} color={r.ok ? 'green' : 'orange'} /></TD>
          <TD>{modoConversor ? <ActBtn variant="del" onClick={() => del(r.id)} title="Excluir">✕</ActBtn> : <ActBtn variant="view">◉</ActBtn>}</TD>
        </TR>)}
      </Tbl>}
      {modoConversor && <button onClick={add} style={{
        width: '100%', padding: '9px', background: '#FEFCF9',
        border: 'none', borderTop: '1px dashed var(--border)', cursor: 'pointer',
        fontSize: '12px', color: 'var(--orange)', fontFamily: 'var(--font)', fontWeight: 500
      }}>
        + Adicionar linha manualmente
      </button>}
    </Card>}

    {tab === 1 && <Card>
      <CardHead title="Mapeamento de colunas para saída CSV" />
      <div style={{ padding: '16px' }}>
        <p style={{ fontSize: '12px', color: 'var(--muted)', marginBottom: '15px' }}>
          O sistema aceita XLSX, CSV e ODS. A saída segue CNPJ;ANO;MES;COD_IBGE;TIPO_CLIENTE;TIPO_ATENDIMENTO;TIPO_MEIO;TIPO_PRODUTO;TIPO_TECNOLOGIA;VELOCIDADE;ACESSOS. Exemplo: 2026 e 2 representa fevereiro de 2026.
        </p>
        <Tbl headers={['Campo no CSV final', 'Nomes aceitos na planilha XLSX', 'Obrigatório']}>
          {[
            ['CNPJ', 'CNPJ, CNPJ_EMPRESA', true], ['ANO', 'ANO, ANO_REFERENCIA', true], ['MES', 'MES, MES_REFERENCIA, MES_REF', true],
            ['COD_IBGE', 'COD_IBGE, CODIGO_IBGE, IBGE, MUNICIPIO_IBGE', true], ['TIPO_CLIENTE', 'TIPO_CLIENTE, CLIENTE, PF_PJ', true],
            ['TIPO_ATENDIMENTO', 'TIPO_ATENDIMENTO, ATENDIMENTO', true], ['TIPO_MEIO', 'TIPO_MEIO, MEIO', true],
            ['TIPO_PRODUTO', 'TIPO_PRODUTO, PRODUTO', true], ['TIPO_TECNOLOGIA', 'TIPO_TECNOLOGIA, TECNOLOGIA', true],
            ['VELOCIDADE', 'VELOCIDADE, VELOCIDADE_MBPS, VELOCIDADE_CONTRATADA', true], ['ACESSOS', 'ACESSOS, QT_ACESSOS, QTD_ACESSOS', true]
          ].map(([c, v, o]) => <TR key={c}><TD mono>{c}</TD>
            <TD style={{ color: 'var(--muted)' }}>{v}</TD>
            <TD><Pill label={o ? 'Sim' : 'Opcional'} color={o ? 'green' : 'gray'} /></TD>
          </TR>)}
        </Tbl>
      </div>
    </Card>}

    {tab === 2 && <Card>
      <CardHead title="Histórico de importações e downloads" />
      <Tbl headers={['Data/hora', 'Ação', 'Usuário', 'Detalhe']}>
        {historico.map((a, i) => <TR key={i}>
          <TD mono style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>{a.dt}</TD>
          <TD><Pill label={a.acao} color="gray" /></TD><TD>{a.user}</TD>
          <TD style={{ color: 'var(--muted)', fontSize: '12px' }}>{a.detalhe}</TD>
        </TR>)}
      </Tbl>
    </Card>}
  </div>;
}
function ViewComprovantes() {
  const { user, isClient, isAdmin, isConsult } = useAuth();

  const fileRef = React.useRef(null);

  const [competencia, setCompetencia] = useState(() => {
    const hoje = new Date();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const ano = hoje.getFullYear();

    return `${ano}-${mes}`;
  });

  const [comprovantes, setComprovantes] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [clienteSelecionado, setClienteSelecionado] = useState('');

  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const carregarClientes = useCallback(async () => {
    if (!isConsult && !isAdmin) return;

    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .order('nome', { ascending: true });

      if (error) {
        throw error;
      }

      const clientesNormalizados = (data || []).map(cliente => ({
        ...cliente,
        cnpj: normalizarCnpj(cliente.cnpj),
      }));

      setClientes(clientesNormalizados);

      if (clientesNormalizados.length > 0 && !clienteSelecionado) {
        setClienteSelecionado(clientesNormalizados[0].cnpj);
      }
    } catch (error) {
      console.error('Erro ao carregar clientes no Supabase:', error);
    }
  }, [isConsult, isAdmin, clienteSelecionado]);

  const carregarComprovantes = useCallback(async () => {
    try {
      setCarregando(true);
      setErro('');

      let query = supabase
        .from('comprovantes')
        .select('*')
        .order('criado_em', { ascending: false });

      if (isClient) {
        query = query.eq('cnpj', normalizarCnpj(user?.cnpj));
      }

      if ((isConsult || isAdmin) && clienteSelecionado) {
        query = query.eq('cnpj', normalizarCnpj(clienteSelecionado));
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      setComprovantes(data || []);
    } catch (error) {
      console.error('Erro ao carregar comprovantes no Supabase:', error);
      setErro(error.message || 'Erro ao carregar comprovantes.');
    } finally {
      setCarregando(false);
    }
  }, [isClient, isConsult, isAdmin, user, clienteSelecionado]);

  useEffect(() => {
    carregarClientes();
    carregarComprovantes();
  }, [carregarClientes, carregarComprovantes]);

  const formatarCompetencia = (valor) => {
    if (!valor) return 'Sem competência';

    const partes = String(valor).split('-');

    if (partes.length === 2) {
      const [ano, mes] = partes;

      const nomesMeses = [
        '',
        'Janeiro',
        'Fevereiro',
        'Março',
        'Abril',
        'Maio',
        'Junho',
        'Julho',
        'Agosto',
        'Setembro',
        'Outubro',
        'Novembro',
        'Dezembro'
      ];

      return `${nomesMeses[Number(mes)] || mes}/${ano}`;
    }

    return valor;
  };

  const anexarComprovante = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    try {
      let cnpjFinal = normalizarCnpj(user?.cnpj);
      let clienteNomeFinal = user?.name || user?.nome || '';

      if (isConsult || isAdmin) {
        if (!clienteSelecionado) {
          alert('Selecione um cliente antes de anexar o comprovante.');
          return;
        }

        const cnpjSelecionadoLimpo = normalizarCnpj(clienteSelecionado);

        const cliente = clientes.find(c =>
          normalizarCnpj(c.cnpj) === cnpjSelecionadoLimpo
        );

        if (!cliente) {
          alert('Cliente selecionado não encontrado. Atualize a página e tente novamente.');
          return;
        }

        cnpjFinal = cnpjSelecionadoLimpo;
        clienteNomeFinal = cliente.nome || '';
      }

      if (!cnpjFinal) {
        alert('Não foi possível identificar o CNPJ do cliente.');
        return;
      }

      if (!competencia) {
        alert('Informe a competência do comprovante.');
        return;
      }

      const nomeSeguro = file.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9.\-_]+/g, '_');

      const caminho = `clientes/${cnpjFinal}/comprovantes-dici/${competencia}/${Date.now()}_${nomeSeguro}`;

      const { error: uploadError } = await supabase.storage
        .from('comprovantes')
        .upload(caminho, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { error: insertError } = await supabase
        .from('comprovantes')
        .insert({
          cnpj: cnpjFinal,
          cliente_nome: clienteNomeFinal,
          competencia,

          nome_arquivo: file.name,
          nome_original: file.name,
          arquivo_path: caminho,

          tamanho_bytes: file.size,
          tipo_arquivo: file.type || null,

          enviado_por: user?.id || null,
          enviado_por_nome: user?.name || user?.nome || user?.email || 'Usuário',
        });

      if (insertError) {
        throw insertError;
      }

      alert('Comprovante anexado com sucesso.');

      await carregarComprovantes();
    } catch (error) {
      console.error('Erro ao anexar comprovante:', error);
      alert(error.message || 'Não foi possível anexar o comprovante.');
    } finally {
      event.target.value = '';
    }
  };

  const baixarComprovante = async (item) => {
    try {
      if (!item.arquivo_path) {
        alert('Este comprovante não possui arquivo vinculado.');
        return;
      }

      const { data, error } = await supabase.storage
        .from('comprovantes')
        .download(item.arquivo_path);

      if (error) {
        throw error;
      }

      const a = document.createElement('a');
      a.href = URL.createObjectURL(data);
      a.download = item.nome_original || item.nome_arquivo || 'comprovante';
      a.click();

      URL.revokeObjectURL(a.href);
    } catch (error) {
      console.error('Erro ao baixar comprovante:', error);
      alert(error.message || 'Não foi possível baixar o comprovante.');
    }
  };

  const excluirComprovante = async (item) => {
    if (!confirm('Deseja excluir este comprovante?')) return;

    try {
      if (item.arquivo_path) {
        const { error: storageError } = await supabase.storage
          .from('comprovantes')
          .remove([item.arquivo_path]);

        if (storageError) {
          throw storageError;
        }
      }

      const { error } = await supabase
        .from('comprovantes')
        .delete()
        .eq('id', item.id);

      if (error) {
        throw error;
      }

      await carregarComprovantes();
    } catch (error) {
      console.error('Erro ao excluir comprovante:', error);
      alert(error.message || 'Não foi possível excluir o comprovante.');
    }
  };

  const formatarData = (valor) => {
    if (!valor) return '—';

    return new Date(valor).toLocaleString('pt-BR');
  };

  const formatarTamanho = (bytes) => {
    if (!bytes) return '—';

    const mb = bytes / 1024 / 1024;

    if (mb >= 1) {
      return mb.toFixed(2) + ' MB';
    }

    return (bytes / 1024).toFixed(1) + ' KB';
  };

  const grupos = comprovantes.reduce((acc, item) => {
    const key = formatarCompetencia(item.competencia);

    acc[key] = acc[key] || [];
    acc[key].push(item);

    return acc;
  }, {});

  return (
    <div>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.csv"
        onChange={anexarComprovante}
        style={{ display: 'none' }}
      />

      <Card>
        <CardHead
          title={
            isClient
              ? 'Meus comprovantes DICI'
              : 'Comprovantes DICI dos clientes'
          }
          action={
            <div style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center',
              flexWrap: 'wrap'
            }}>
              {(isConsult || isAdmin) && (
                <select
                  value={clienteSelecionado}
                  onChange={(e) => setClienteSelecionado(e.target.value)}
                  style={{
                    padding: '5px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontFamily: 'var(--font)',
                    outline: 'none',
                    background: '#fff',
                    minWidth: '240px'
                  }}
                >
                  <option value="">Selecione o cliente</option>

                  {clientes.map(cliente => (
                    <option key={cliente.id} value={normalizarCnpj(cliente.cnpj)}>
                      {cliente.nome} — {normalizarCnpj(cliente.cnpj)}
                    </option>
                  ))}
                </select>
              )}

              {(isConsult || isAdmin) && (
                <input
                  type="month"
                  value={competencia}
                  onChange={(e) => setCompetencia(e.target.value)}
                  style={{
                    padding: '5px 10px',
                    border: '1px solid var(--border)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontFamily: 'var(--font)',
                    outline: 'none',
                    background: '#fff',
                  }}
                />
              )}

              {(isConsult || isAdmin) && (
                <Btn
                  variant="primary"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                >
                  + Anexar comprovante
                </Btn>
              )}
            </div>
          }
        />

        <div style={{
          padding: '12px 16px',
          fontSize: '12px',
          color: 'var(--muted)',
          borderBottom: '1px solid var(--border)',
          lineHeight: 1.5
        }}>
          {isClient
            ? 'Aqui você acompanha os comprovantes DICI anexados pela equipe SCM.'
            : 'Selecione o cliente e a competência para anexar o comprovante DICI.'}
        </div>

        {carregando && (
          <div style={{
            padding: '34px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '13px'
          }}>
            Carregando comprovantes...
          </div>
        )}

        {erro && (
          <div style={{
            padding: '20px',
            color: 'var(--red)',
            fontSize: '13px'
          }}>
            {erro}
          </div>
        )}

        {!carregando && !erro && comprovantes.length === 0 && (
          <div style={{
            padding: '34px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '13px'
          }}>
            Nenhum comprovante anexado ainda.
          </div>
        )}

        {!carregando && !erro && Object.entries(grupos).map(([competenciaTexto, lista]) => (
          <div key={competenciaTexto}>
            <div style={{
              padding: '12px 16px',
              fontWeight: 600,
              fontSize: '13px',
              background: '#FAFAF8',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span>{competenciaTexto}</span>

              <Pill
                label={`${lista.length} ${lista.length === 1 ? 'comprovante' : 'comprovantes'}`}
                color="gray"
              />
            </div>

            <Tbl headers={['CNPJ', 'Arquivo', 'Anexado em', 'Anexado por', 'Tamanho', 'Ações']}>
              {lista.map(item => (
                <TR key={item.id}>
                  <TD mono>{item.cnpj || '—'}</TD>

                  <TD>
                    <div style={{ fontWeight: 500 }}>
                      {item.nome_original || item.nome_arquivo || '—'}
                    </div>

                    <div style={{
                      fontSize: '11px',
                      color: 'var(--muted)',
                      marginTop: '2px'
                    }}>
                      {item.tipo_arquivo || 'Tipo não identificado'}
                    </div>
                  </TD>

                  <TD mono>{formatarData(item.criado_em)}</TD>

                  <TD>{item.enviado_por_nome || '—'}</TD>

                  <TD mono>{formatarTamanho(item.tamanho_bytes)}</TD>

                  <TD>
                    <ActBtn
                      variant="dl"
                      title="Baixar comprovante"
                      onClick={() => baixarComprovante(item)}
                    >
                      ⬇
                    </ActBtn>

                    {(isConsult || isAdmin) && (
                      <ActBtn
                        variant="del"
                        title="Excluir comprovante"
                        onClick={() => excluirComprovante(item)}
                      >
                        ✕
                      </ActBtn>
                    )}
                  </TD>
                </TR>
              ))}
            </Tbl>
          </div>
        ))}
      </Card>
    </div>
  );
}

function IconePastaWindows({ size = 42 }) {
  const largura = size * 1.2;
  const altura = size * 0.82;

  return (
    <div
      style={{
        width: largura,
        height: altura,
        position: 'relative',
        display: 'inline-block',
        flexShrink: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: largura * 0.06,
          top: 0,
          width: largura * 0.42,
          height: altura * 0.28,
          background: 'linear-gradient(180deg, #FFD86B, #E9AE22)',
          borderRadius: '5px 5px 0 0',
          border: '1px solid rgba(154, 103, 0, .18)',
          boxSizing: 'border-box',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: altura * 0.76,
          background: 'linear-gradient(180deg, #FFE28A 0%, #F7C84A 48%, #E3A91C 100%)',
          borderRadius: '5px',
          border: '1px solid rgba(154, 103, 0, .22)',
          boxShadow: '0 5px 10px rgba(0,0,0,.12), inset 0 1px 0 rgba(255,255,255,.45)',
          boxSizing: 'border-box',
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: largura * 0.08,
          right: largura * 0.08,
          top: altura * 0.34,
          height: 1,
          background: 'rgba(255,255,255,.45)',
        }}
      />
    </div>
  );
}

function obterIconeArquivoDocumento(item = {}) {
  const tipo = String(item.tipo_arquivo || '').toLowerCase();
  const nome = String(item.nome_original || item.nome_arquivo || '').toLowerCase();

  if (tipo.includes('pdf') || nome.endsWith('.pdf')) return '📕';
  if (tipo.includes('image') || /\.(png|jpg|jpeg|webp|gif)$/i.test(nome)) return '🖼️';
  if (tipo.includes('spreadsheet') || /\.(xlsx|xls|csv|ods)$/i.test(nome)) return '📗';
  if (tipo.includes('word') || /\.(doc|docx)$/i.test(nome)) return '📘';
  if (/\.(zip|rar|7z)$/i.test(nome)) return '🗜️';

  return '📄';
}

function normalizarNomeArquivoStorage(nome = '') {
  return removerAcentos(String(nome || 'arquivo'))
    .replace(/[^a-zA-Z0-9.\-_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizarParteCaminhoDocumento(valor = '') {
  return removerAcentos(String(valor || 'Geral'))
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\/+|\/+$/g, '');
}

function normalizarCaminhoDocumento(caminho = 'Geral') {
  const partes = String(caminho || 'Geral')
    .split('/')
    .map(parte => normalizarParteCaminhoDocumento(parte))
    .filter(Boolean);

  if (partes.length === 0) return 'Geral';

  if (partes[0].toLowerCase() !== 'geral') {
    partes.unshift('Geral');
  }

  return partes.join('/');
}

function caminhoSeguroStorageDocumento(caminho = 'Geral') {
  return normalizarCaminhoDocumento(caminho)
    .split('/')
    .map(parte => normalizarNomeArquivoStorage(parte))
    .filter(Boolean)
    .join('/');
}

function formatarTamanhoDocumento(bytes) {
  const valor = Number(bytes || 0);

  if (!valor) return '—';

  if (valor < 1024) return `${valor} B`;

  const kb = valor / 1024;

  if (kb < 1024) return `${kb.toFixed(1)} KB`;

  const mb = kb / 1024;

  if (mb < 1024) return `${mb.toFixed(1)} MB`;

  const gb = mb / 1024;

  return `${gb.toFixed(2)} GB`;
}
function ViewDocumentosGerais() {
  const { user, isClient, isAdmin, isConsult, isSupervisor } = useAuth();

  const fileRef = React.useRef(null);
  const folderRef = React.useRef(null);

  const [documentos, setDocumentos] = useState([]);
  const [pastas, setPastas] = useState([]);
  const [clientes, setClientes] = useState([]);

  const [clienteSelecionado, setClienteSelecionado] = useState('');
  const [categoria, setCategoria] = useState('Outros');
  const [descricao, setDescricao] = useState('');
  const [busca, setBusca] = useState('');

  const [pastaAtual, setPastaAtual] = useState('Geral');
  const [pastaAtualId, setPastaAtualId] = useState(null);
  const [novaPasta, setNovaPasta] = useState('');

  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [arrastandoArquivo, setArrastandoArquivo] = useState(false);
  const [enviandoArquivos, setEnviandoArquivos] = useState(false);
  const [progressoUpload, setProgressoUpload] = useState('');

  const podeSelecionarCliente = isAdmin || isConsult || isSupervisor;

  const clienteAtual = React.useMemo(() => {
    if (isClient) {
      return {
        nome: user?.name || user?.nome || 'Cliente',
        cnpj: normalizarCnpj(user?.cnpj),
      };
    }

    const cnpjSelecionado = normalizarCnpj(clienteSelecionado);

    return clientes.find(cliente => {
      return normalizarCnpj(cliente.cnpj) === cnpjSelecionado;
    }) || null;
  }, [isClient, user, clientes, clienteSelecionado]);

  const cnpjAtual = normalizarCnpj(clienteAtual?.cnpj);
  const nomeClienteAtual = clienteAtual?.nome || user?.name || user?.nome || 'Cliente';

  const carregarClientes = useCallback(async () => {
    if (!podeSelecionarCliente) return;

    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('id, usuario_id, nome, cnpj, email, consultor, status')
        .order('nome', { ascending: true });

      if (error) {
        throw error;
      }

      let lista = (data || []).map(cliente => ({
        ...cliente,
        cnpj: normalizarCnpj(cliente.cnpj),
      }));

      if (isConsult) {
        lista = lista.filter(cliente => {
          return consultorPertenceAoUsuario(cliente.consultor, user);
        });
      }

      setClientes(lista);

      const selecionadoAindaExiste = lista.some(cliente => {
        return normalizarCnpj(cliente.cnpj) === normalizarCnpj(clienteSelecionado);
      });

      if (lista.length > 0 && (!clienteSelecionado || !selecionadoAindaExiste)) {
        setClienteSelecionado(lista[0].cnpj);
      }

      if (lista.length === 0) {
        setClienteSelecionado('');
      }
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
      setClientes([]);
    }
  }, [
    podeSelecionarCliente,
    isConsult,
    user,
    clienteSelecionado,
  ]);

  const carregarPastas = useCallback(async () => {
    if (!cnpjAtual) {
      setPastas([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('documentos_gerais_pastas')
        .select('*')
        .eq('cnpj', cnpjAtual)
        .order('caminho', { ascending: true });

      if (error) {
        throw error;
      }

      setPastas(data || []);
    } catch (error) {
      console.error('Erro ao carregar pastas:', error);
      setPastas([]);
    }
  }, [cnpjAtual]);

  const carregarDocumentos = useCallback(async () => {
    try {
      setCarregando(true);
      setErro('');

      if (!cnpjAtual) {
        setDocumentos([]);
        return;
      }

      const { data, error } = await supabase
        .from('documentos_gerais')
        .select('*')
        .eq('cnpj', cnpjAtual)
        .order('criado_em', { ascending: false });

      if (error) {
        throw error;
      }

      setDocumentos(data || []);
    } catch (error) {
      console.error('Erro ao carregar documentos gerais:', error);
      setErro(error.message || 'Erro ao carregar documentos gerais.');
    } finally {
      setCarregando(false);
    }
  }, [cnpjAtual]);

  useEffect(() => {
    carregarClientes();
  }, [carregarClientes]);

  useEffect(() => {
    setPastaAtual('Geral');
    setPastaAtualId(null);
  }, [cnpjAtual]);

  useEffect(() => {
    carregarPastas();
    carregarDocumentos();
  }, [carregarPastas, carregarDocumentos]);

  const encontrarPastaPorCaminho = useCallback((caminho) => {
    const caminhoNormalizado = normalizarCaminhoDocumento(caminho);

    return pastas.find(pasta => {
      return normalizarCaminhoDocumento(pasta.caminho) === caminhoNormalizado;
    }) || null;
  }, [pastas]);

  const garantirPasta = useCallback(async (cnpj, clienteNome, caminho) => {
    const caminhoNormalizado = normalizarCaminhoDocumento(caminho);

    if (!cnpj || caminhoNormalizado === 'Geral') {
      return null;
    }

    const existenteLocal = pastas.find(pasta => {
      return normalizarCaminhoDocumento(pasta.caminho) === caminhoNormalizado;
    });

    if (existenteLocal) {
      return existenteLocal;
    }

    const { data: existenteBanco, error: erroBusca } = await supabase
      .from('documentos_gerais_pastas')
      .select('*')
      .eq('cnpj', cnpj)
      .eq('caminho', caminhoNormalizado)
      .maybeSingle();

    if (erroBusca) {
      throw erroBusca;
    }

    if (existenteBanco) {
      return existenteBanco;
    }

    const partes = caminhoNormalizado.split('/');
    const nome = partes[partes.length - 1];
    const caminhoPai = partes.slice(0, -1).join('/') || 'Geral';

    let pastaPai = null;

    if (caminhoPai && caminhoPai !== 'Geral') {
      pastaPai = await garantirPasta(cnpj, clienteNome, caminhoPai);
    }

    const payload = {
      cnpj,
      cliente_nome: clienteNome,
      nome,
      caminho: caminhoNormalizado,
      pasta_pai_id: pastaPai?.id || null,
      criado_por: user?.id || null,
      criado_por_nome: user?.name || user?.nome || user?.email || 'Usuário',
    };

    const { data: criada, error: erroInsert } = await supabase
      .from('documentos_gerais_pastas')
      .insert(payload)
      .select()
      .single();

    if (erroInsert) {
      if (erroInsert.code === '23505') {
        const { data: pastaDuplicada, error: erroDuplicada } = await supabase
          .from('documentos_gerais_pastas')
          .select('*')
          .eq('cnpj', cnpj)
          .eq('caminho', caminhoNormalizado)
          .maybeSingle();

        if (erroDuplicada) {
          throw erroDuplicada;
        }

        return pastaDuplicada;
      }

      throw erroInsert;
    }

    return criada;
  }, [pastas, user]);

  const criarPasta = async () => {
    try {
      const nome = novaPasta.trim();

      if (!nome) {
        alert('Digite o nome da pasta.');
        return;
      }

      if (!cnpjAtual) {
        alert('Selecione um cliente antes de criar pasta.');
        return;
      }

      const caminho = normalizarCaminhoDocumento(`${pastaAtual}/${nome}`);
      const jaExiste = encontrarPastaPorCaminho(caminho);

      if (jaExiste) {
        alert('Essa pasta já existe neste local.');
        return;
      }

      await garantirPasta(cnpjAtual, nomeClienteAtual, caminho);

      setNovaPasta('');
      await carregarPastas();
    } catch (error) {
      console.error('Erro ao criar pasta:', error);
      alert(error.message || 'Não foi possível criar a pasta.');
    }
  };

  const abrirPasta = (pasta) => {
    setPastaAtual(normalizarCaminhoDocumento(pasta.caminho));
    setPastaAtualId(pasta.id || null);
  };

  const navegarParaCaminho = (caminho) => {
    const caminhoNormalizado = normalizarCaminhoDocumento(caminho);

    if (caminhoNormalizado === 'Geral') {
      setPastaAtual('Geral');
      setPastaAtualId(null);
      return;
    }

    const pastaEncontrada = encontrarPastaPorCaminho(caminhoNormalizado);

    setPastaAtual(caminhoNormalizado);
    setPastaAtualId(pastaEncontrada?.id || null);
  };

  const voltarUmaPasta = () => {
    const partes = pastaAtual.split('/').filter(Boolean);

    if (partes.length <= 1) {
      setPastaAtual('Geral');
      setPastaAtualId(null);
      return;
    }

    const novoCaminho = partes.slice(0, -1).join('/');
    navegarParaCaminho(novoCaminho);
  };

  const lerDiretorioRecursivo = useCallback((entry, caminhoBase = '') => {
    return new Promise(resolve => {
      if (!entry) {
        resolve([]);
        return;
      }

      if (entry.isFile) {
        entry.file(
          file => {
            resolve([
              {
                file,
                relativePath: `${caminhoBase}${file.name}`,
              },
            ]);
          },
          () => resolve([])
        );

        return;
      }

      if (entry.isDirectory) {
        const reader = entry.createReader();
        const todasEntries = [];

        const lerTudo = () => {
          reader.readEntries(
            entries => {
              if (!entries.length) {
                Promise
                  .all(
                    todasEntries.map(filho => {
                      return lerDiretorioRecursivo(filho, `${caminhoBase}${entry.name}/`);
                    })
                  )
                  .then(resultados => resolve(resultados.flat()));

                return;
              }

              todasEntries.push(...entries);
              lerTudo();
            },
            () => resolve([])
          );
        };

        lerTudo();
        return;
      }

      resolve([]);
    });
  }, []);

  const extrairArquivosDoDrop = useCallback(async (event) => {
    event.preventDefault();

    const items = Array.from(event.dataTransfer?.items || []);

    if (items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      const resultados = await Promise.all(
        items.map(item => {
          const entry = item.webkitGetAsEntry();

          if (!entry) return [];

          return lerDiretorioRecursivo(entry, '');
        })
      );

      return resultados.flat();
    }

    return Array.from(event.dataTransfer?.files || []).map(file => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));
  }, [lerDiretorioRecursivo]);

  const anexarArquivos = async (arquivosEntrada) => {
    const lista = Array.from(arquivosEntrada || [])
      .map(item => {
        if (item?.file) return item;

        return {
          file: item,
          relativePath: item?.webkitRelativePath || item?.name,
        };
      })
      .filter(item => item?.file);

    if (lista.length === 0) return;

    if (!cnpjAtual) {
      alert('Selecione um cliente antes de anexar documentos.');
      return;
    }

    try {
      setEnviandoArquivos(true);

      for (let index = 0; index < lista.length; index++) {
        const item = lista[index];
        const file = item.file;

        setProgressoUpload(`Enviando ${index + 1} de ${lista.length}: ${file.name}`);

        const relativePath = String(item.relativePath || file.webkitRelativePath || file.name);
        const partes = relativePath.split('/').filter(Boolean);
        const partesPasta = partes.length > 1 ? partes.slice(0, -1) : [];

        const caminhoDestino = partesPasta.length > 0
          ? normalizarCaminhoDocumento(`${pastaAtual}/${partesPasta.join('/')}`)
          : normalizarCaminhoDocumento(pastaAtual);

        const pastaRegistro = await garantirPasta(cnpjAtual, nomeClienteAtual, caminhoDestino);

        const nomeSeguro = normalizarNomeArquivoStorage(file.name);
        const pastaSegura = caminhoSeguroStorageDocumento(caminhoDestino);

        const caminhoStorage = `clientes/${cnpjAtual}/documentos-gerais/${pastaSegura}/${Date.now()}_${index}_${nomeSeguro}`;

        const { error: uploadError } = await supabase.storage
          .from('documentos-gerais')
          .upload(caminhoStorage, file, {
            cacheControl: '3600',
            upsert: false,
          });

        if (uploadError) {
          throw uploadError;
        }

        const nomePastaFinal = caminhoDestino.split('/').filter(Boolean).pop() || 'Geral';

        const { error: insertError } = await supabase
          .from('documentos_gerais')
          .insert({
            cnpj: cnpjAtual,
            cliente_nome: nomeClienteAtual,

            pasta: nomePastaFinal,
            pasta_path: caminhoDestino,
            pasta_id: pastaRegistro?.id || null,

            categoria: categoria || 'Outros',
            descricao: descricao.trim() || null,

            nome_arquivo: file.name,
            nome_original: file.name,
            arquivo_path: caminhoStorage,

            tamanho_bytes: file.size,
            tipo_arquivo: file.type || null,

            enviado_por: user?.id || null,
            enviado_por_nome: user?.name || user?.nome || user?.email || 'Usuário',
          });

        if (insertError) {
          throw insertError;
        }
      }

      setDescricao('');

      await carregarPastas();
      await carregarDocumentos();

      alert(`${lista.length} arquivo(s) anexado(s) com sucesso.`);
    } catch (error) {
      console.error('Erro ao anexar documentos:', error);
      alert(error.message || 'Não foi possível anexar os documentos.');
    } finally {
      setEnviandoArquivos(false);
      setProgressoUpload('');
    }
  };

  const anexarDocumentoInput = async (event) => {
    const arquivos = Array.from(event.target.files || []).map(file => ({
      file,
      relativePath: file.webkitRelativePath || file.name,
    }));

    await anexarArquivos(arquivos);

    event.target.value = '';
  };

  const handleDrop = async (event) => {
    event.preventDefault();
    setArrastandoArquivo(false);

    const arquivos = await extrairArquivosDoDrop(event);
    await anexarArquivos(arquivos);
  };

  const baixarDocumento = async (item) => {
    try {
      if (!item.arquivo_path) {
        alert('Este documento não possui arquivo vinculado.');
        return;
      }

      const { data, error } = await supabase.storage
        .from('documentos-gerais')
        .download(item.arquivo_path);

      if (error) {
        throw error;
      }

      const a = document.createElement('a');
      a.href = URL.createObjectURL(data);
      a.download = item.nome_original || item.nome_arquivo || 'documento';
      a.click();

      URL.revokeObjectURL(a.href);
    } catch (error) {
      console.error('Erro ao baixar documento:', error);
      alert(error.message || 'Não foi possível baixar o documento.');
    }
  };

  const excluirDocumento = async (item) => {
    if (!confirm('Deseja excluir este documento?')) return;

    try {
      if (item.arquivo_path) {
        const { error: storageError } = await supabase.storage
          .from('documentos-gerais')
          .remove([item.arquivo_path]);

        if (storageError) {
          throw storageError;
        }
      }

      const { error } = await supabase
        .from('documentos_gerais')
        .delete()
        .eq('id', item.id);

      if (error) {
        throw error;
      }

      await carregarDocumentos();
    } catch (error) {
      console.error('Erro ao excluir documento:', error);
      alert(error.message || 'Não foi possível excluir o documento.');
    }
  };

  const excluirPasta = async (pasta) => {
    const caminho = normalizarCaminhoDocumento(pasta.caminho);

    const possuiSubpasta = pastas.some(item => {
      const caminhoItem = normalizarCaminhoDocumento(item.caminho);

      return caminhoItem.startsWith(`${caminho}/`);
    });

    const possuiDocumento = documentos.some(item => {
      const caminhoDocumento = normalizarCaminhoDocumento(item.pasta_path || item.pasta || 'Geral');

      return caminhoDocumento === caminho || caminhoDocumento.startsWith(`${caminho}/`);
    });

    if (possuiSubpasta || possuiDocumento) {
      alert('A pasta precisa estar vazia para ser excluída.');
      return;
    }

    if (!confirm(`Deseja excluir a pasta "${pasta.nome}"?`)) return;

    try {
      const { error } = await supabase
        .from('documentos_gerais_pastas')
        .delete()
        .eq('id', pasta.id);

      if (error) {
        throw error;
      }

      await carregarPastas();
    } catch (error) {
      console.error('Erro ao excluir pasta:', error);
      alert(error.message || 'Não foi possível excluir a pasta.');
    }
  };

  const formatarData = (valor) => {
    if (!valor) return '—';

    return new Date(valor).toLocaleString('pt-BR');
  };

  const obterPastaDocumento = (item) => {
    return normalizarCaminhoDocumento(item.pasta_path || item.pasta || 'Geral');
  };

  const pastasFilhas = React.useMemo(() => {
    const prefixo = pastaAtual === 'Geral'
      ? 'Geral/'
      : `${pastaAtual}/`;

    return pastas
      .filter(pasta => {
        const caminho = normalizarCaminhoDocumento(pasta.caminho);

        if (!caminho.startsWith(prefixo)) return false;

        const resto = caminho.slice(prefixo.length);

        return resto && !resto.includes('/');
      })
      .filter(pasta => {
        if (!busca.trim()) return true;

        const q = normalizarBusca(busca);

        return normalizarBusca(`${pasta.nome} ${pasta.caminho}`).includes(q);
      });
  }, [pastas, pastaAtual, busca]);

  const documentosDaPastaAtual = React.useMemo(() => {
    return documentos
      .filter(item => {
        return obterPastaDocumento(item) === pastaAtual;
      })
      .filter(item => {
        if (!busca.trim()) return true;

        const q = normalizarBusca(busca);

        const alvo = normalizarBusca(`
          ${item.nome_arquivo || ''}
          ${item.nome_original || ''}
          ${item.descricao || ''}
          ${item.categoria || ''}
          ${item.enviado_por_nome || ''}
        `);

        return alvo.includes(q);
      });
  }, [documentos, pastaAtual, busca]);

  const totalTamanho = documentos.reduce((total, item) => {
    return total + (Number(item.tamanho_bytes) || 0);
  }, 0);

  const ultimoEnvio = documentos[0]?.criado_em
    ? formatarData(documentos[0].criado_em)
    : '—';

  const breadcrumb = pastaAtual.split('/').filter(Boolean);

  const inputStyle = {
    width: '100%',
    padding: '9px 10px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    fontSize: '12px',
    fontFamily: 'var(--font)',
    outline: 'none',
    background: '#fff',
    boxSizing: 'border-box',
  };

  return (
    <div className="scm-fade-in">
      <input
        ref={fileRef}
        type="file"
        multiple
        onChange={anexarDocumentoInput}
        style={{ display: 'none' }}
      />

      <input
        ref={folderRef}
        type="file"
        multiple
        webkitdirectory=""
        directory=""
        onChange={anexarDocumentoInput}
        style={{ display: 'none' }}
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '12px',
        marginBottom: '14px',
      }}>
        <StatCard value={documentos.length} label="Documentos" accent="black" />
        <StatCard value={pastas.length} label="Pastas criadas" accent="orange" />
        <StatCard value={formatarTamanhoDocumento(totalTamanho)} label="Tamanho total" accent="blue" />
        <StatCard value={ultimoEnvio} label="Último envio" accent="green" />
      </div>

      <Card>
        <CardHead
          title="Explorador de documentos"
          action={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Btn
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={enviandoArquivos || !cnpjAtual}
              >
                + Escolher arquivos
              </Btn>

              
            </div>
          }
        />

        <div style={{ padding: '14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
            gap: '10px',
            marginBottom: '10px',
          }}>
            {podeSelecionarCliente && (
              <select
                value={clienteSelecionado}
                onChange={(e) => setClienteSelecionado(e.target.value)}
                style={inputStyle}
              >
                {clientes.length === 0 && (
                  <option value="">Nenhum cliente disponível</option>
                )}

                {clientes.map(cliente => (
                  <option key={cliente.id} value={normalizarCnpj(cliente.cnpj)}>
                    {cliente.nome} — {formatarCnpj(cliente.cnpj || '')}
                  </option>
                ))}
              </select>
            )}

            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              style={inputStyle}
            >
              <option value="Outros">Outros</option>
              <option value="Contratos">Contratos</option>
              <option value="Procurações">Procurações</option>
              <option value="Licenças">Licenças</option>
              <option value="Relatórios">Relatórios</option>
              <option value="Documentos da empresa">Documentos da empresa</option>
            </select>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pasta, documento, categoria ou usuário..."
              style={inputStyle}
            />
          </div>

          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição opcional dos próximos arquivos enviados..."
            rows={2}
            style={{
              ...inputStyle,
              resize: 'vertical',
              marginBottom: '10px',
            }}
          />

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: '8px',
            alignItems: 'center',
          }}>
            <input
              value={novaPasta}
              onChange={(e) => setNovaPasta(e.target.value)}
              placeholder={`Criar nova pasta dentro de: ${pastaAtual}`}
              style={inputStyle}
            />

            <Btn
              variant="dark"
              onClick={criarPasta}
              disabled={!cnpjAtual}
            >
              + Criar pasta
            </Btn>
          </div>
        </div>

        <div style={{
          padding: '12px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          background: '#FAFAF8',
        }}>
          <button
            type="button"
            onClick={() => navegarParaCaminho('Geral')}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--orange)',
              fontWeight: 700,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Geral
          </button>

          {breadcrumb.slice(1).map((parte, index) => {
            const caminho = breadcrumb.slice(0, index + 2).join('/');

            return (
              <React.Fragment key={caminho}>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>›</span>

                <button
                  type="button"
                  onClick={() => navegarParaCaminho(caminho)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: index === breadcrumb.length - 2 ? 'var(--text)' : 'var(--orange)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  {parte}
                </button>
              </React.Fragment>
            );
          })}

          {pastaAtual !== 'Geral' && (
            <Btn size="sm" onClick={voltarUmaPasta} style={{ marginLeft: 'auto' }}>
              Voltar
            </Btn>
          )}
        </div>

        <div
          onDragOver={(event) => {
            event.preventDefault();
            setArrastandoArquivo(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setArrastandoArquivo(false);
          }}
          onDrop={handleDrop}
          style={{
            margin: '14px',
            padding: '26px 18px',
            borderRadius: '18px',
            border: arrastandoArquivo
              ? '2px dashed var(--orange)'
              : '2px dashed rgba(217,95,0,.28)',
            background: arrastandoArquivo
              ? '#FFF4EC'
              : '#FFFCF8',
            textAlign: 'center',
            transition: 'all .18s ease',
          }}
        >
          <div style={{ fontSize: 34, marginBottom: 8 }}>
            {arrastandoArquivo ? '📥' : '📁'}
          </div>

          <div style={{
            fontSize: 15,
            fontWeight: 800,
            color: arrastandoArquivo ? 'var(--orange)' : 'var(--text)',
          }}>
            {arrastandoArquivo
              ? 'Solte para enviar'
              : 'Arraste arquivos aqui'}
          </div>

          <div style={{
            fontSize: 12,
            color: 'var(--muted)',
            marginTop: 5,
            lineHeight: 1.5,
          }}>
            Os arquivos serão anexados em <strong>{pastaAtual}</strong>.
          </div>

          {enviandoArquivos && (
            <div style={{
              marginTop: 12,
              fontSize: 12,
              color: 'var(--orange)',
              fontWeight: 700,
            }}>
              {progressoUpload || 'Enviando arquivos...'}
            </div>
          )}
        </div>

        {erro && (
          <div style={{
            margin: '0 14px 14px',
            padding: '10px 12px',
            borderRadius: '10px',
            background: '#FFF0F0',
            color: 'var(--red)',
            border: '1px solid #F5C6C6',
            fontSize: 12,
          }}>
            {erro}
          </div>
        )}

        {carregando ? (
          <div style={{
            padding: 34,
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: 13,
          }}>
            Carregando documentos...
          </div>
        ) : (
          <div style={{ padding: '0 14px 16px' }}>
            {pastasFilhas.length === 0 && documentosDaPastaAtual.length === 0 ? (
              <Empty
                msg="Esta pasta está vazia"
                sub="Arraste arquivos ou pastas para começar a organizar os documentos."
                icon="📁"
              />
            ) : (
              <>
                {pastasFilhas.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '.06em',
                      marginBottom: 9,
                    }}>
                      Pastas
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                      gap: 10,
                    }}>
                      {pastasFilhas.map(pasta => (
                        <div
                          key={pasta.id}
                          onDoubleClick={() => abrirPasta(pasta)}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: '14px',
                            padding: '12px',
                            background: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            cursor: 'pointer',
                            boxShadow: '0 5px 14px rgba(0,0,0,.04)',
                          }}
                        >
                          <IconePastaWindows size={38} />

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 13,
                              fontWeight: 800,
                              color: 'var(--text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {pasta.nome}
                            </div>

                            <div style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              marginTop: 3,
                            }}>
                              Pasta de arquivos
                            </div>
                          </div>

                          <ActBtn
                            variant="view"
                            title="Abrir pasta"
                            onClick={() => abrirPasta(pasta)}
                          >
                            ↗
                          </ActBtn>

                          <ActBtn
                            variant="del"
                            title="Excluir pasta vazia"
                            onClick={() => excluirPasta(pasta)}
                          >
                            ✕
                          </ActBtn>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {documentosDaPastaAtual.length > 0 && (
                  <div>
                    <div style={{
                      fontSize: 12,
                      fontWeight: 800,
                      color: 'var(--muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '.06em',
                      marginBottom: 9,
                    }}>
                      Arquivos
                    </div>

                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))',
                      gap: 10,
                    }}>
                      {documentosDaPastaAtual.map(item => (
                        <div
                          key={item.id}
                          style={{
                            border: '1px solid var(--border)',
                            borderRadius: '14px',
                            padding: '12px',
                            background: '#fff',
                            display: 'flex',
                            gap: 11,
                            alignItems: 'flex-start',
                            boxShadow: '0 5px 14px rgba(0,0,0,.04)',
                          }}
                        >
                          <div style={{
                            width: 38,
                            height: 38,
                            borderRadius: '10px',
                            background: '#FAFAF8',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 20,
                            flexShrink: 0,
                          }}>
                            {obterIconeArquivoDocumento(item)}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{
                              fontSize: 13,
                              fontWeight: 800,
                              color: 'var(--text)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}>
                              {item.nome_original || item.nome_arquivo || 'Documento'}
                            </div>

                            <div style={{
                              fontSize: 11,
                              color: 'var(--muted)',
                              marginTop: 4,
                              lineHeight: 1.4,
                            }}>
                              {item.descricao || 'Sem descrição'}
                            </div>

                            <div style={{
                              display: 'flex',
                              gap: 6,
                              flexWrap: 'wrap',
                              marginTop: 8,
                            }}>
                              <Pill label={item.categoria || 'Outros'} color="gray" />
                              <Pill label={formatarTamanhoDocumento(item.tamanho_bytes)} color="blue" />
                            </div>

                            <div style={{
                              fontSize: 10,
                              color: 'var(--faint)',
                              marginTop: 7,
                              lineHeight: 1.4,
                            }}>
                              Enviado por {item.enviado_por_nome || 'Usuário'} · {formatarData(item.criado_em)}
                            </div>
                          </div>

                          <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                            flexShrink: 0,
                          }}>
                            <ActBtn
                              variant="dl"
                              title="Baixar documento"
                              onClick={() => baixarDocumento(item)}
                            >
                              ⬇
                            </ActBtn>

                            <ActBtn
                              variant="del"
                              title="Excluir documento"
                              onClick={() => excluirDocumento(item)}
                            >
                              ✕
                            </ActBtn>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function ViewIntegracaoColetas() {
  const { user, isClient, isAdmin, isConsult } = useAuth();
  const isMobile = useMobile();

  const anoAtual = new Date().getFullYear();

  const meses = [
    { value: '1', label: 'Janeiro' },
    { value: '2', label: 'Fevereiro' },
    { value: '3', label: 'Março' },
    { value: '4', label: 'Abril' },
    { value: '5', label: 'Maio' },
    { value: '6', label: 'Junho' },
    { value: '7', label: 'Julho' },
    { value: '8', label: 'Agosto' },
    { value: '9', label: 'Setembro' },
    { value: '10', label: 'Outubro' },
    { value: '11', label: 'Novembro' },
    { value: '12', label: 'Dezembro' },
  ];

  const anos = Array.from({ length: 5 }, (_, i) => String(anoAtual - i));

  const sistemas = [
    {
      id: 'ixc',
      nome: 'IXC Soft',
      subtitulo: 'Sistema de gestão IXC Provedor',
      descricao: 'Puxa clientes, planos, velocidades e acessos diretamente do IXC.',
      cor: '#0F6FA8',
      bg: '#E6F3FF',
      icone: '🖥️',
      functionName: 'gerar-csv-dici',
      campos: [
        { key: 'baseUrl', label: 'URL Base do IXC', placeholder: 'https://seudominio.com/webservice/v1', type: 'text' },
        { key: 'token', label: 'Token de acesso', placeholder: 'Token da API do IXC', type: 'password' },
        { key: 'testResource', label: 'Recurso para teste', placeholder: 'cliente', type: 'text' },
      ],
    },
    {
      id: 'sgp',
      nome: 'SGP / TSMX',
      subtitulo: 'Sistema de Gestão de Provedores',
      descricao: 'Busca dados do SGP para gerar o arquivo de coleta DICI.',
      cor: '#1E7E34',
      bg: '#EAF7EE',
      icone: '🗄️',
      functionName: 'gerar-csv-dici-sgp',
      campos: [
        { key: 'baseUrl', label: 'URL Base do SGP', placeholder: 'https://seudominio.sgp.net.br', type: 'text' },
        { key: 'token', label: 'Token de acesso', placeholder: 'Token da API do SGP', type: 'password' },
        { key: 'app', label: 'Nome da aplicação', placeholder: 'ispbanking', type: 'text' },
        { key: 'testResource', label: 'Recurso para teste', placeholder: '/api/ura/titulos', type: 'text' },
      ],
    },
    {
      id: 'hubsoft',
      nome: 'Hubsoft',
      subtitulo: 'ERP para provedores',
      descricao: 'Consulta serviços, clientes e acessos diretamente do Hubsoft.',
      cor: '#6F42C1',
      bg: '#F3EFFF',
      icone: '☁️',
      functionName: 'gerar-csv-dici-hubsoft',
      campos: [
        { key: 'baseUrl', label: 'URL Base do Hubsoft', placeholder: 'https://seudominio.hubsoft.com.br', type: 'text' },
        { key: 'clientId', label: 'Client ID', placeholder: 'Client ID da integração', type: 'text' },
        { key: 'clientSecret', label: 'Client Secret', placeholder: 'Client Secret da integração', type: 'password' },
        { key: 'username', label: 'Usuário', placeholder: 'Usuário da API', type: 'text' },
        { key: 'password', label: 'Senha', placeholder: 'Senha da API', type: 'password' },
        { key: 'testResource', label: 'Recurso para teste', placeholder: '/api/v1/integracao/cliente/atendimento', type: 'text' },
      ],
    },
  ];

  const chaveStorage = `scm_integracao_coletas_${user?.id || user?.email || 'geral'}`;

  const carregarConfigInicial = () => {
    try {
      return JSON.parse(localStorage.getItem(chaveStorage) || '{}');
    } catch {
      return {};
    }
  };

  const [erpAtivo, setErpAtivo] = useState(() => {
    const config = carregarConfigInicial();
    return config.erpAtivo || 'ixc';
  });

  const [configs, setConfigs] = useState(() => {
    const config = carregarConfigInicial();
    return config.configs || {};
  });

  const [ano, setAno] = useState(String(anoAtual));
  const [mes, setMes] = useState(String(new Date().getMonth() + 1));

  const [salvando, setSalvando] = useState(false);
  const [testando, setTestando] = useState(false);
  const [gerando, setGerando] = useState(false);

  const [resultadoTeste, setResultadoTeste] = useState(null);
  const [resultadoGeracao, setResultadoGeracao] = useState(null);
  const [progresso, setProgresso] = useState(0);

  const sistemaAtual = sistemas.find(s => s.id === erpAtivo) || sistemas[0];
  const configAtual = configs[erpAtivo] || {};

  const salvarLocal = (novoErp, novasConfigs) => {
    localStorage.setItem(chaveStorage, JSON.stringify({
      erpAtivo: novoErp,
      configs: novasConfigs,
      atualizadoEm: new Date().toISOString(),
    }));
  };

  const alterarErp = (id) => {
    setErpAtivo(id);
    setResultadoTeste(null);
    setResultadoGeracao(null);
    salvarLocal(id, configs);
  };

  const atualizarCampo = (campo, valor) => {
    setConfigs(prev => {
      const novasConfigs = {
        ...prev,
        [erpAtivo]: {
          ...(prev[erpAtivo] || {}),
          [campo]: valor,
        },
      };

      salvarLocal(erpAtivo, novasConfigs);

      return novasConfigs;
    });
  };

  const camposObrigatoriosPreenchidos = () => {
    const camposObrigatorios = sistemaAtual.campos.filter(c => c.key !== 'testResource');

    return camposObrigatorios.every(campo => {
      return String(configAtual[campo.key] || '').trim() !== '';
    });
  };

  const salvarConfiguracao = () => {
    try {
      setSalvando(true);

      if (!camposObrigatoriosPreenchidos()) {
        alert('Preencha os campos obrigatórios da integração antes de salvar.');
        return;
      }

      salvarLocal(erpAtivo, configs);

      alert(`Configuração do ${sistemaAtual.nome} salva com sucesso.`);
    } finally {
      setSalvando(false);
    }
  };

  const PROXY_POR_SISTEMA = {
    ixc: {
      functionName: 'ixc-proxy',
      montarBody: (cfg) => ({
        resource: cfg.testResource || 'cliente',
        method: 'POST',
        ixc_base_url: cfg.baseUrl,
        ixc_token: cfg.token,
      }),
    },
    hubsoft: {
      functionName: 'hubsoft-proxy',
      montarBody: (cfg) => ({
        resource: cfg.testResource || '/api/v1/integracao/cliente/atendimento',
        method: 'GET',
        hubsoft_base_url: cfg.baseUrl,
        hubsoft_client_id: cfg.clientId,
        hubsoft_client_secret: cfg.clientSecret,
        hubsoft_username: cfg.username,
        hubsoft_password: cfg.password,
        config: cfg,
      }),
    },
  };

  const testarConexao = async () => {
    if (!camposObrigatoriosPreenchidos()) {
      alert('Preencha os dados da integração antes de testar.');
      return;
    }

    const proxy = PROXY_POR_SISTEMA[erpAtivo];

    if (!proxy) {
      setResultadoTeste({
        success: false,
        message: `Teste de conexão para ${sistemaAtual.nome} ainda não está disponível.`,
      });
      return;
    }

    try {
      setTestando(true);
      setResultadoTeste(null);

      const authHeaders = await obterAuthHeaders();

      const { data, error } = await supabase.functions.invoke(proxy.functionName, {
        body: proxy.montarBody(configAtual),
        headers: authHeaders,
      });

      if (error) {
        throw error;
      }

      if (data?.success) {
        setResultadoTeste({
          success: true,
          message: data.message || `Conexão com ${sistemaAtual.nome} realizada com sucesso.`,
        });
      } else {
        setResultadoTeste({
          success: false,
          message: data?.error || `Não foi possível conectar ao ${sistemaAtual.nome}.`,
        });
      }

    } catch (error) {
      console.error('Erro ao testar integração:', error);

      const msgBruta = String(error?.message || '');
      const ehSessao = error instanceof SessaoExpiradaError || /sessao_expirada/i.test(msgBruta);
      const ehErroTecnico = /non-2xx|functionshttperror|40[13]/i.test(msgBruta);

      setResultadoTeste({
        success: false,
        message: ehSessao
          ? 'Sua sessão expirou. Faça login novamente e tente outra vez.'
          : ehErroTecnico
            ? `Não foi possível conectar ao ${sistemaAtual.nome}. Verifique os dados da integração e tente novamente.`
            : (msgBruta || `Não foi possível testar a conexão com ${sistemaAtual.nome}.`),
      });

    } finally {
      setTestando(false);
    }
  };

  const baixarCsvConteudo = (conteudo, nomeArquivo) => {
    const conteudoFinal = conteudo.startsWith('\uFEFF')
      ? conteudo
      : '\uFEFF' + conteudo;

    const blob = new Blob([conteudoFinal], {
      type: 'text/csv;charset=utf-8;',
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nomeArquivo || 'coleta-dici.csv';
    a.click();

    URL.revokeObjectURL(a.href);
  };

  // Helpers para montar o CSV no navegador (necessários para o modo chunk do Hubsoft,
  // que retorna linhas brutas em vez do CSV pronto).
  const CSV_HEADERS_DICI = [
    'CNPJ', 'ANO', 'MES', 'COD_IBGE', 'TIPO_CLIENTE',
    'TIPO_ATENDIMENTO', 'TIPO_MEIO', 'TIPO_PRODUTO', 'TIPO_TECNOLOGIA',
    'VELOCIDADE', 'ACESSOS',
  ];

  const csvEscapeValor = (valor) => {
    const texto = String(valor ?? '').replace(/\r?\n/g, ' ').trim();
    if (/[;"\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`;
    return texto;
  };

  const dedupLinhasDici = (linhas) => {
    const camposChave = CSV_HEADERS_DICI.filter((c) => c !== 'ACESSOS');
    const mapa = new Map();
    for (const linha of linhas) {
      const chave = camposChave.map((c) => String(linha[c] ?? '').trim()).join('|');
      if (!mapa.has(chave)) {
        mapa.set(chave, { ...linha, ACESSOS: String(Number(linha.ACESSOS) || 0) });
      } else {
        const atual = mapa.get(chave);
        atual.ACESSOS = String((Number(atual.ACESSOS) || 0) + (Number(linha.ACESSOS) || 0));
      }
    }
    return Array.from(mapa.values());
  };

  const montarCsvDici = (linhas) => {
    const header = CSV_HEADERS_DICI.join(';');
    const body = linhas
      .map((l) => CSV_HEADERS_DICI.map((c) => csvEscapeValor(l[c])).join(';'))
      .join('\r\n');
    return '﻿' + header + '\r\n' + body;
  };

  const puxarArquivoColeta = async () => {
    if (!camposObrigatoriosPreenchidos()) {
      alert(`Configure a integração ${sistemaAtual.nome} antes de puxar o arquivo.`);
      return;
    }

    if (!sistemaAtual?.functionName) {
      alert(`A geração do arquivo de coleta para ${sistemaAtual.nome} ainda não está disponível.`);
      return;
    }

    try {
      setGerando(true);
      setResultadoGeracao(null);
      setProgresso(5);

      const authHeaders = await obterAuthHeaders();

      const cnpjFinal = normalizarCnpj(user?.cnpj);

      if (!cnpjFinal && isClient) {
        alert('Não foi possível identificar o CNPJ da empresa logada.');
        return;
      }

      const nomeEmpresa = user?.name || user?.nome || 'EMPRESA';
      const nomeArquivoFinal = montarNomeArquivoPadrao({
        ano,
        mes,
        competencia: `${String(mes).padStart(2, '0')}/${ano}`,
        empresa: nomeEmpresa,
      });

      const bodyBase = {
        ano: Number(ano),
        mes: Number(mes),
        cnpj: cnpjFinal,
        empresa: nomeEmpresa,
        sistema: erpAtivo,
        config: configAtual,
        resource: configAtual.collectionResource || configAtual.testResource || '',
      };

      // ============== Modo chunk (Hubsoft) ==============
      // Backend devolve linhas brutas + cursor; o frontend chama em loop
      // até `tem_mais=false`, depois faz dedup e monta o CSV no navegador.
      if (erpAtivo === 'hubsoft') {
        let startPage = 1;
        const todasLinhas = [];
        let totalPaginas = 0;
        let totalClientes = 0;
        let totalIgnoradas = 0;
        let fileNameSugerido = nomeArquivoFinal;
        let authMetodoUsado = '';
        let chamadas = 0;
        let concluido = false;
        const MAX_CHAMADAS = 200; // limite defensivo (suporta ~400k clientes com rp=200 × 10 pgs/chamada)

        while (chamadas < MAX_CHAMADAS) {
          chamadas++;

          const { data, error } = await supabase.functions.invoke(sistemaAtual.functionName, {
            body: { ...bodyBase, startPage, rp: 200, pagesPerCall: 10, ibgeConcurrency: 15 },
            headers: authHeaders,
          });

          if (error) throw error;
          if (!data) throw new Error('A integração não retornou dados.');
          if (data.success === false) throw new Error(data.error || 'Erro ao gerar o arquivo.');

          if (Array.isArray(data.linhas)) {
            todasLinhas.push(...data.linhas);
          }
          totalClientes += data.total_lote_clientes || 0;
          totalIgnoradas += (data.total_lote_linhas_brutas || 0) - (data.total_lote_linhas_validas || 0);
          totalPaginas = data.total_paginas || totalPaginas;
          authMetodoUsado = data.auth_metodo || authMetodoUsado;
          fileNameSugerido = data.file_name_sugerido || fileNameSugerido;

          if (totalPaginas > 0) {
            const pct = Math.min(95, Math.round((data.pagina_processada / totalPaginas) * 90) + 5);
            setProgresso(pct);
          }

          if (!data.tem_mais) { concluido = true; break; }
          startPage = data.proxima_pagina;
        }

        if (!concluido) {
          throw new Error(`Limite de ${MAX_CHAMADAS} invocações atingido sem completar a coleta. Reduza pagesPerCall ou aumente o teto.`);
        }

        if (todasLinhas.length === 0) {
          throw new Error('Nenhuma linha DICI válida foi extraída do Hubsoft.');
        }

        const linhasFinais = dedupLinhasDici(todasLinhas);
        const csvFinal = montarCsvDici(linhasFinais);
        const totalAcessos = linhasFinais.reduce((t, l) => t + (Number(l.ACESSOS) || 0), 0);

        setResultadoGeracao({
          success: true,
          sistema: sistemaAtual.nome,
          fileName: fileNameSugerido,
          recordsCount: linhasFinais.length,
          totalAcessos,
          totalOriginal: totalClientes,
          ignoradosSemIbge: totalIgnoradas,
          resource: configAtual.collectionResource || 'padrão Hubsoft',
          geradoEm: new Date().toLocaleString('pt-BR'),
          chamadas,
          authMetodo: authMetodoUsado,
        });
        setProgresso(100);
        baixarCsvConteudo(csvFinal, fileNameSugerido);
        return;
      }

      // ============== Modo single-shot (IXC e demais) ==============
      setProgresso(35);

      const { data, error } = await supabase.functions.invoke(sistemaAtual.functionName, {
        body: bodyBase,
        headers: authHeaders,
      });

      setProgresso(75);

      if (error) throw error;
      if (!data) throw new Error('A integração não retornou dados.');
      if (data.success === false) {
        // Em vez de só mostrar a mensagem, exibimos o diagnóstico que a função
        // já devolve (campos disponíveis, exemplo de registro, mapa de cidades),
        // para conseguirmos ajustar o recurso/mapeamento dos campos do IXC.
        console.warn('Diagnóstico da integração (success=false):', data);
        setResultadoGeracao({
          success: false,
          error: data.error || 'A integração retornou erro ao gerar o arquivo.',
          dica: data.dica,
          resource: data.resource,
          totalOriginal: data.total_original,
          totalAtivos: data.total_ativos,
          ignoradosSemIbge: data.total_ignorados_sem_ibge,
          mapaCidadesTamanho: data.mapa_cidades_tamanho,
          mapaCidadesEndpoint: data.mapa_cidades_endpoint,
          mapaClientesTamanho: data.mapa_clientes_tamanho,
          camposDisponiveis: data.campos_disponiveis,
          exemploRegistro: data.exemplo_primeiro_registro,
          exemploLinhaDici: data.exemplo_linha_dici,
          geradoEm: new Date().toLocaleString('pt-BR'),
        });
        setProgresso(0);
        return;
      }

      const nomeArquivoBaixar = data.file_name || data.fileName || nomeArquivoFinal;

      setResultadoGeracao({
        success: true,
        sistema: sistemaAtual.nome,
        fileName: nomeArquivoBaixar,
        recordsCount: data.records_count || data.recordsCount || 0,
        totalAcessos: data.total_acessos || data.totalAcessos || 0,
        totalOriginal: data.total_original || 0,
        ignoradosSemIbge: data.total_ignorados_sem_ibge || 0,
        resource: data.resource || configAtual.testResource || 'cliente',
        geradoEm: new Date().toLocaleString('pt-BR'),
      });
      setProgresso(100);

      if (data.csv_content || data.csvContent) {
        baixarCsvConteudo(data.csv_content || data.csvContent, nomeArquivoBaixar);
      } else {
        alert('Arquivo gerado, mas a função não retornou o conteúdo CSV.');
      }

    } catch (error) {
      console.error('Erro ao puxar arquivo da integração:', error);

      const msgBruta = String(error?.message || '');
      const ehSessao = error instanceof SessaoExpiradaError || /sessao_expirada/i.test(msgBruta);
      const ehErroTecnicoFuncao = /non-2xx|functionshttperror|40[13]/i.test(msgBruta);

      setResultadoGeracao({
        success: false,
        error: ehSessao
          ? 'Sua sessão expirou. Faça login novamente e tente gerar o arquivo outra vez.'
          : ehErroTecnicoFuncao
            ? 'Não foi possível gerar o arquivo. Verifique se a planilha foi enviada corretamente ou tente novamente.'
            : (msgBruta || 'Não foi possível puxar o arquivo do sistema.'),
        geradoEm: new Date().toLocaleString('pt-BR'),
      });

      setProgresso(0);
    } finally {
      setGerando(false);
    }
  };

  return (
    <div>
      <Banner
        role={isClient ? 'client' : isAdmin ? 'admin' : 'consult'}
        icon="🔌"
        title="Integração automática de coletas"
        sub="Puxe o arquivo da Coleta DICI diretamente do sistema da empresa, sem precisar importar planilha manualmente."
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1.2fr .8fr',
        gap: '14px',
      }}>
        <Card>
          <CardHead
            title="Sistema de coleta conectado"
            action={
              <Pill
                label={camposObrigatoriosPreenchidos() ? 'Configurado' : 'Pendente'}
                color={camposObrigatoriosPreenchidos() ? 'green' : 'orange'}
              />
            }
          />

          <div style={{ padding: '16px' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
              gap: '10px',
              marginBottom: '16px',
            }}>
              {sistemas.map(sistema => {
                const ativo = erpAtivo === sistema.id;
                const configSistema = configs[sistema.id] || {};
                const configurado = sistema.campos
                  .filter(c => c.key !== 'testResource')
                  .every(c => String(configSistema[c.key] || '').trim() !== '');

                return (
                  <button
                    key={sistema.id}
                    type="button"
                    onClick={() => alterarErp(sistema.id)}
                    style={{
                      textAlign: 'left',
                      border: ativo ? `2px solid ${sistema.cor}` : '1px solid var(--border)',
                      background: ativo ? sistema.bg : '#fff',
                      borderRadius: '16px',
                      padding: '14px',
                      cursor: 'pointer',
                      boxShadow: ativo ? '0 10px 22px rgba(0,0,0,.08)' : 'none',
                      transition: 'all .2s ease',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '8px',
                    }}>
                      <div style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '12px',
                        background: ativo ? '#fff' : sistema.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '18px',
                      }}>
                        {sistema.icone}
                      </div>

                      {ativo && (
                        <span style={{
                          width: '9px',
                          height: '9px',
                          borderRadius: '50%',
                          background: sistema.cor,
                          boxShadow: `0 0 0 4px ${sistema.bg}`,
                        }} />
                      )}
                    </div>

                    <div style={{
                      fontSize: '13px',
                      fontWeight: 700,
                      color: 'var(--text)',
                    }}>
                      {sistema.nome}
                    </div>

                    <div style={{
                      fontSize: '11px',
                      color: 'var(--muted)',
                      marginTop: '3px',
                      lineHeight: 1.4,
                    }}>
                      {sistema.subtitulo}
                    </div>

                    <div style={{ marginTop: '9px' }}>
                      <Pill
                        label={configurado ? 'Configurado' : 'Não configurado'}
                        color={configurado ? 'green' : 'gray'}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={{
              border: `1px solid ${sistemaAtual.cor}`,
              borderRadius: '18px',
              background: '#fff',
              overflow: 'hidden',
            }}>
              <div style={{
                padding: '14px',
                background: sistemaAtual.bg,
                borderBottom: '1px solid var(--border)',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}>
                  <div style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '13px',
                    background: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '19px',
                  }}>
                    {sistemaAtual.icone}
                  </div>

                  <div>
                    <div style={{
                      fontSize: '15px',
                      fontWeight: 800,
                    }}>
                      {sistemaAtual.nome}
                    </div>

                    <div style={{
                      fontSize: '12px',
                      color: 'var(--muted)',
                      marginTop: '2px',
                    }}>
                      {sistemaAtual.descricao}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{
                padding: '14px',
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: '11px',
              }}>
                {sistemaAtual.campos.map(campo => (
                  <div key={campo.key}>
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--muted)',
                      marginBottom: '5px',
                      fontWeight: 600,
                    }}>
                      {campo.label}
                    </div>

                    <input
                      type={campo.type}
                      value={configAtual[campo.key] || ''}
                      onChange={(e) => atualizarCampo(campo.key, e.target.value)}
                      placeholder={campo.placeholder}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        border: '1px solid var(--border)',
                        borderRadius: '11px',
                        fontSize: '12px',
                        fontFamily: campo.type === 'password' || campo.key.includes('Url') || campo.key === 'baseUrl'
                          ? 'var(--mono)'
                          : 'var(--font)',
                        outline: 'none',
                        background: '#FAFAF8',
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                ))}

                {resultadoTeste && (
                  <div style={{
                    padding: '10px 12px',
                    borderRadius: '12px',
                    background: resultadoTeste.success ? '#EAF7EE' : '#FFF0F0',
                    border: resultadoTeste.success ? '1px solid #BFE6C8' : '1px solid #F5C6C6',
                    color: resultadoTeste.success ? '#1E7E34' : 'var(--red)',
                    fontSize: '12px',
                    lineHeight: 1.5,
                  }}>
                    {resultadoTeste.success ? '✅ ' : '❌ '}
                    {resultadoTeste.message}
                  </div>
                )}

                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '8px',
                  justifyContent: 'flex-end',
                }}>
                  <Btn
                    size="sm"
                    onClick={salvarConfiguracao}
                    disabled={salvando}
                  >
                    {salvando ? 'Salvando...' : 'Salvar configuração'}
                  </Btn>

                  <Btn
                    size="sm"
                    variant="dark"
                    onClick={testarConexao}
                    disabled={testando}
                  >
                    {testando ? 'Testando...' : 'Testar conexão'}
                  </Btn>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Puxar arquivo da Coleta DICI" />

          <div style={{ padding: '16px' }}>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: '16px',
              background: '#FAFAF8',
              padding: '13px',
              marginBottom: '12px',
            }}>
              <div style={{
                fontSize: '12px',
                color: 'var(--muted)',
                marginBottom: '4px',
              }}>
                Empresa
              </div>

              <div style={{
                fontSize: '14px',
                fontWeight: 700,
              }}>
                {user?.name || user?.nome || 'Empresa não identificada'}
              </div>

              <div style={{
                fontSize: '12px',
                color: 'var(--muted)',
                marginTop: '4px',
                fontFamily: 'var(--mono)',
              }}>
                {formatarCnpj(user?.cnpj || '') || 'CNPJ não informado'}
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: '10px',
              marginBottom: '12px',
            }}>
              <div>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--muted)',
                  marginBottom: '5px',
                  fontWeight: 600,
                }}>
                  Ano
                </div>

                <select
                  value={ano}
                  onChange={(e) => setAno(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '11px',
                    fontSize: '12px',
                    background: '#fff',
                    outline: 'none',
                  }}
                >
                  {anos.map(item => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{
                  fontSize: '11px',
                  color: 'var(--muted)',
                  marginBottom: '5px',
                  fontWeight: 600,
                }}>
                  Mês
                </div>

                <select
                  value={mes}
                  onChange={(e) => setMes(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '11px',
                    fontSize: '12px',
                    background: '#fff',
                    outline: 'none',
                  }}
                >
                  {meses.map(item => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{
              padding: '13px',
              borderRadius: '16px',
              background: sistemaAtual.bg,
              border: `1px solid ${sistemaAtual.cor}`,
              marginBottom: '12px',
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                marginBottom: '8px',
              }}>
                <div>
                  <div style={{
                    fontSize: '13px',
                    fontWeight: 700,
                  }}>
                    Sistema ERP ativo
                  </div>

                  <div style={{
                    fontSize: '12px',
                    color: 'var(--muted)',
                    marginTop: '2px',
                  }}>
                    Os dados serão extraídos do {sistemaAtual.nome}.
                  </div>
                </div>

                <Pill
                  label={sistemaAtual.nome}
                  color={erpAtivo === 'ixc' ? 'blue' : erpAtivo === 'sgp' ? 'green' : 'gray'}
                />
              </div>

              <div style={{
                fontSize: '12px',
                color: 'var(--muted)',
                lineHeight: 1.5,
              }}>
                Referência: <strong>{meses.find(m => m.value === mes)?.label}/{ano}</strong>
              </div>
            </div>

            {gerando && (
              <div style={{
                marginBottom: '12px',
                padding: '12px',
                borderRadius: '14px',
                background: '#fff',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  marginBottom: '8px',
                }}>
                  <span>Gerando CSV via {sistemaAtual.nome}...</span>
                  <strong>{progresso}%</strong>
                </div>

                <div style={{
                  height: '8px',
                  borderRadius: '99px',
                  background: '#F0EEE8',
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${progresso}%`,
                    height: '100%',
                    background: sistemaAtual.cor,
                    transition: 'width .3s ease',
                  }} />
                </div>
              </div>
            )}

            <Btn
              variant="primary"
              onClick={puxarArquivoColeta}
              disabled={gerando}
              style={{
                width: '100%',
                padding: '13px',
                borderRadius: '14px',
                fontWeight: 800,
              }}
            >
              {gerando ? 'Puxando arquivo...' : '⬇ Puxar CSV do sistema da empresa'}
            </Btn>

            {resultadoGeracao && (
              <div style={{
                marginTop: '12px',
                padding: '13px',
                borderRadius: '14px',
                background: resultadoGeracao.success ? '#EAF7EE' : '#FFF0F0',
                border: resultadoGeracao.success ? '1px solid #BFE6C8' : '1px solid #F5C6C6',
                fontSize: '12px',
                lineHeight: 1.6,
                color: resultadoGeracao.success ? '#1E7E34' : 'var(--red)',
              }}>
                {resultadoGeracao.success ? (
                  <>
                    <strong>Arquivo gerado com sucesso!</strong><br />
                    Sistema: {resultadoGeracao.sistema}<br />
                    Arquivo: {resultadoGeracao.fileName}<br />
                    Registros: {resultadoGeracao.recordsCount || 0}<br />
                    Acessos: {resultadoGeracao.totalAcessos || 0}<br />
                    Gerado em: {resultadoGeracao.geradoEm}
                  </>
                ) : (
                  <>
                    <strong>Erro ao gerar arquivo</strong><br />
                    {resultadoGeracao.error}

                    {resultadoGeracao.dica && (
                      <><br /><br /><strong>Dica:</strong> {resultadoGeracao.dica}</>
                    )}

                    {(resultadoGeracao.resource || resultadoGeracao.mapaCidadesTamanho !== undefined) && (
                      <>
                        <br /><br />
                        Recurso usado: <strong>{resultadoGeracao.resource || '—'}</strong><br />
                        Registros recebidos: {resultadoGeracao.totalOriginal ?? '—'}<br />
                        {resultadoGeracao.totalAtivos !== undefined && (
                          <>Ativos (internet): {resultadoGeracao.totalAtivos}<br /></>
                        )}
                        Mapa de cidades (IBGE): {resultadoGeracao.mapaCidadesTamanho ?? '—'}
                        {resultadoGeracao.mapaCidadesEndpoint
                          ? ` (via "${resultadoGeracao.mapaCidadesEndpoint}")`
                          : ''}
                        {resultadoGeracao.mapaClientesTamanho !== undefined && (
                          <><br />Mapa de clientes: {resultadoGeracao.mapaClientesTamanho}</>
                        )}
                      </>
                    )}

                    {resultadoGeracao.exemploLinhaDici && (
                      <>
                        <br /><br />
                        <strong>Linha DICI de exemplo (campo vazio = falta mapear):</strong>
                        <div style={{
                          marginTop: '4px',
                          padding: '8px',
                          borderRadius: '8px',
                          background: '#fff',
                          border: '1px solid #F5C6C6',
                          fontFamily: 'var(--mono)',
                          fontSize: '11px',
                          maxHeight: '160px',
                          overflow: 'auto',
                          wordBreak: 'break-word',
                        }}>
                          {Object.entries(resultadoGeracao.exemploLinhaDici).map(([k, v]) => (
                            <div key={k} style={{ color: String(v).trim() === '' ? 'var(--red)' : 'inherit' }}>
                              {k}: {String(v).trim() === '' ? '(vazio)' : String(v)}
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {Array.isArray(resultadoGeracao.camposDisponiveis) && resultadoGeracao.camposDisponiveis.length > 0 && (
                      <>
                        <br /><br />
                        <strong>Campos retornados pelo IXC:</strong>
                        <div style={{
                          marginTop: '4px',
                          padding: '8px',
                          borderRadius: '8px',
                          background: '#fff',
                          border: '1px solid #F5C6C6',
                          fontFamily: 'var(--mono)',
                          fontSize: '11px',
                          maxHeight: '120px',
                          overflow: 'auto',
                          wordBreak: 'break-word',
                        }}>
                          {resultadoGeracao.camposDisponiveis.join(', ')}
                        </div>
                      </>
                    )}

                    {resultadoGeracao.exemploRegistro && (() => {
                      // Mostra só os valores dos campos relevantes para o mapeamento
                      // DICI (plano/velocidade/status/cidade), evitando dados pessoais.
                      const REGEX_RELEVANTE = /plano|plan|veloc|mega|mbps|gbps|status|tecnolog|meio|fibra|radio|cabo|sat|tipo|cidade|contrato|descricao|produto|localidade|ibge/i;
                      const entradas = Object.entries(resultadoGeracao.exemploRegistro)
                        .filter(([k, v]) => REGEX_RELEVANTE.test(k) && v !== null && v !== '' && typeof v !== 'object')
                        .slice(0, 30);
                      if (entradas.length === 0) return null;
                      return (
                        <>
                          <br /><br />
                          <strong>Valores de exemplo (1º registro):</strong>
                          <div style={{
                            marginTop: '4px',
                            padding: '8px',
                            borderRadius: '8px',
                            background: '#fff',
                            border: '1px solid #F5C6C6',
                            fontFamily: 'var(--mono)',
                            fontSize: '11px',
                            maxHeight: '160px',
                            overflow: 'auto',
                            wordBreak: 'break-word',
                          }}>
                            {entradas.map(([k, v]) => (
                              <div key={k}>{k}: {String(v).slice(0, 80)}</div>
                            ))}
                          </div>
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
            )}

            <div style={{
              marginTop: '14px',
              padding: '12px',
              borderRadius: '14px',
              background: '#FFF4EC',
              border: '1px solid #F5C9A0',
              color: 'var(--orange-d)',
              fontSize: '12px',
              lineHeight: 1.5,
            }}>
              <strong>Observação:</strong> a integração com IXC Soft já está ativa.
              Caso o CSV venha sem linhas, verifique o recurso utilizado e o mapeamento dos campos retornados pelo IXC.
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
function ViewPlanilhas() {
  const { user, isClient, isConsult, isAdmin } = useAuth();
  const isMobile = useMobile();

  const [items, setItems] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroCompetencia, setFiltroCompetencia] = useState('todas');

  const [planilhaEditando, setPlanilhaEditando] = useState(null);
  const [linhasEditando, setLinhasEditando] = useState([]);
  const [salvandoEdicao, setSalvandoEdicao] = useState(false);

  const CSV_HEADERS = [
    'CNPJ',
    'ANO',
    'MES',
    'COD_IBGE',
    'TIPO_CLIENTE',
    'TIPO_ATENDIMENTO',
    'TIPO_MEIO',
    'TIPO_PRODUTO',
    'TIPO_TECNOLOGIA',
    'VELOCIDADE',
    'ACESSOS'
  ];

  const HEADER_LABELS = {
    CNPJ: 'CNPJ',
    ANO: 'Ano',
    MES: 'Mês',
    COD_IBGE: 'Cód. IBGE',
    TIPO_CLIENTE: 'Cliente',
    TIPO_ATENDIMENTO: 'Atend.',
    TIPO_MEIO: 'Meio',
    TIPO_PRODUTO: 'Produto',
    TIPO_TECNOLOGIA: 'Tecnologia',
    VELOCIDADE: 'Velocidade',
    ACESSOS: 'Acessos',
  };

  const statusInfo = {
    recebido: {
      label: 'Recebido',
      color: 'blue',
      bg: '#E6F3FF',
      border: '#B8DBF5',
      text: '#0F6FA8',
      icon: '📥',
    },
    em_processamento: {
      label: 'Em processamento',
      color: 'orange',
      bg: '#FFF4EC',
      border: '#F5C9A0',
      text: '#B04D00',
      icon: '⚙️',
    },
    finalizado: {
      label: 'Finalizado',
      color: 'gray',
      bg: '#F5F4F0',
      border: '#DDDAD2',
      text: '#555',
      icon: '✅',
    },
    comprovante_anexado: {
      label: 'Com comprovante',
      color: 'green',
      bg: '#EAF7EE',
      border: '#BFE6C8',
      text: '#1E7E34',
      icon: '📎',
    },
    Importada: {
      label: 'Recebido',
      color: 'blue',
      bg: '#E6F3FF',
      border: '#B8DBF5',
      text: '#0F6FA8',
      icon: '📥',
    },
  };

  const ordemStatus = [
    'recebido',
    'em_processamento',
    'finalizado',
    'comprovante_anexado',
  ];

  const normalizarStatus = (status) => {
    if (!status) return 'recebido';
    if (status === 'Importada') return 'recebido';
    return status;
  };

const normalizarNomeConsultor = (valor = '') => {
  return removerAcentos(String(valor || ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

const carregarPlanilhas = useCallback(async () => {
  try {
    setCarregando(true);
    setErro('');

    let cnpjsPermitidosConsultor = null;
    let usuariosPermitidosConsultor = null;

    if (isConsult) {
      const { data: clientesConsultor, error: erroClientes } = await supabase
        .from('clientes')
        .select('id, usuario_id, nome, cnpj, consultor, email');

      if (erroClientes) {
        throw erroClientes;
      }

      const meusClientes = (clientesConsultor || []).filter(cliente => {
        return consultorPertenceAoUsuario(cliente.consultor, user);
      });

      cnpjsPermitidosConsultor = new Set(
        meusClientes
          .map(cliente => normalizarCnpj(cliente.cnpj))
          .filter(Boolean)
      );

      usuariosPermitidosConsultor = new Set(
        meusClientes
          .map(cliente => cliente.usuario_id)
          .filter(Boolean)
      );

      if (
        cnpjsPermitidosConsultor.size === 0 &&
        usuariosPermitidosConsultor.size === 0
      ) {
        setItems([]);
        return;
      }
    }

    let query = supabase
      .from('planilhas_coleta')
      .select('*')
      .order('criado_em', { ascending: false });

    if (isClient) {
      query = query.eq('usuario_id', user?.id);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    let planilhas = data || [];

    if (isConsult) {
      planilhas = planilhas.filter(planilha => {
        const batePorCnpj = cnpjsPermitidosConsultor.has(
          normalizarCnpj(planilha.cnpj)
        );

        const batePorUsuario = usuariosPermitidosConsultor.has(
          planilha.usuario_id
        );

        return batePorCnpj || batePorUsuario;
      });
    }

    setItems(planilhas);
  } catch (error) {
    console.error('Erro ao carregar planilhas no Supabase:', error);
    setErro(error.message || 'Erro ao carregar planilhas.');
  } finally {
    setCarregando(false);
  }
}, [
  isClient,
  isConsult,
  user?.id,
  user?.nome,
  user?.name,
  user?.email,
]);

  useEffect(() => {
    carregarPlanilhas();
  }, [carregarPlanilhas]);

  const formatarData = (valor) => {
    if (!valor) return '—';

    return new Date(valor).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatarCompetenciaPlanilha = (item) => {
    const meses = [
      '',
      'Janeiro',
      'Fevereiro',
      'Março',
      'Abril',
      'Maio',
      'Junho',
      'Julho',
      'Agosto',
      'Setembro',
      'Outubro',
      'Novembro',
      'Dezembro',
    ];

    const ano = Number(item.competencia_ano);
    const mes = Number(item.competencia_mes);

    if (ano && mes) {
      return `${meses[mes] || String(mes).padStart(2, '0')}/${ano}`;
    }

    return item.competencia || 'Sem competência';
  };

  const chaveCompetencia = (item) => {
    const ano = Number(item.competencia_ano);
    const mes = Number(item.competencia_mes);

    if (ano && mes) {
      return `${ano}-${String(mes).padStart(2, '0')}`;
    }

    return item.competencia || 'sem_competencia';
  };

  const csvEscape = (v) => {
    const s = String(v ?? '').replace(/\r?\n/g, ' ').trim();

    return /[;"\n]/.test(s)
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };

  const obterLinhasPlanilha = (item) => {
    let linhas = item.dados_json || [];

    if (typeof linhas === 'string') {
      try {
        linhas = JSON.parse(linhas);
      } catch {
        linhas = [];
      }
    }

    return Array.isArray(linhas) ? linhas : [];
  };

  const contarAcessos = (item) => {
    const linhas = obterLinhasPlanilha(item);

    return linhas.reduce((total, linha) => {
      return total + (Number(linha.ACESSOS) || 0);
    }, 0);
  };

  const baixarPlanilha = async (item) => {
    try {
      const linhas = obterLinhasPlanilha(item);

      if (!Array.isArray(linhas) || linhas.length === 0) {
        alert('Esta planilha não possui dados para baixar.');
        return;
      }

      const header = CSV_HEADERS.join(';');

      const body = linhas
        .map(linha => CSV_HEADERS.map(campo => csvEscape(linha[campo])).join(';'))
        .join('\r\n');

      const conteudo = '\uFEFF' + header + '\r\n' + body;

      const primeiraLinha = linhas[0] || {};

      const a = document.createElement('a');

      a.href = URL.createObjectURL(new Blob([conteudo], {
        type: 'text/csv;charset=utf-8;',
      }));

      a.download = item.nome_arquivo_final || montarNomeArquivoPadrao({
        ano: primeiraLinha.ANO || item.competencia_ano,
        mes: primeiraLinha.MES || item.competencia_mes,
        competencia: item.competencia,
        empresa: item.cliente_nome || 'EMPRESA',
      });

      a.click();

      URL.revokeObjectURL(a.href);
    } catch (error) {
      console.error('Erro ao baixar planilha:', error);
      alert(error.message || 'Não foi possível baixar a planilha.');
    }
  };

  const abrirEditorPlanilha = async (item) => {
    try {
      const linhas = obterLinhasPlanilha(item);

      setPlanilhaEditando(item);
      setLinhasEditando(linhas);
    } catch (error) {
      console.error('Erro ao abrir editor da planilha:', error);
      alert(error.message || 'Não foi possível abrir a planilha.');
    }
  };

  const atualizarLinhaEditando = (index, campo, valor) => {
    setLinhasEditando(prev => {
      const novasLinhas = [...prev];

      let valorFinal = valor;

      if (campo === 'CNPJ') {
        valorFinal = String(valor || '').replace(/\D/g, '').padStart(14, '0').slice(-14);
      }

      if (campo === 'VELOCIDADE') {
        valorFinal = normalizarVelocidade(valor);
      }

      if (campo === 'TIPO_TECNOLOGIA') {
        const normalizado = String(valor || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toUpperCase()
          .replace(/\s+/g, '')
          .replace(/_/g, '-');

        if (
          normalizado === 'WI-FI' ||
          normalizado === 'WIFI' ||
          normalizado === 'WI FI'
        ) {
          valorFinal = 'Wi-Fi';
        } else {
          valorFinal = String(valor || '').toUpperCase();
        }
      }

      novasLinhas[index] = {
        ...novasLinhas[index],
        [campo]: valorFinal,
      };

      return novasLinhas;
    });
  };

  const excluirLinhaEditando = (index) => {
    if (!confirm('Deseja excluir esta linha da planilha?')) return;

    setLinhasEditando(prev => prev.filter((_, i) => i !== index));
  };

  const adicionarLinhaEditando = () => {
    setLinhasEditando(prev => [
      ...prev,
      {
        CNPJ: prev[0]?.CNPJ || '',
        ANO: prev[0]?.ANO || planilhaEditando?.competencia_ano || '',
        MES: prev[0]?.MES || planilhaEditando?.competencia_mes || '',
        COD_IBGE: '',
        TIPO_CLIENTE: 'PF',
        TIPO_ATENDIMENTO: 'URBANO',
        TIPO_MEIO: 'fibra',
        TIPO_PRODUTO: 'internet',
        TIPO_TECNOLOGIA: 'FTTH',
        VELOCIDADE: '',
        ACESSOS: '',
      },
    ]);
  };

  const salvarEdicaoPlanilha = async () => {
    if (!planilhaEditando) return;

    try {
      setSalvandoEdicao(true);

      const { error } = await supabase
        .from('planilhas_coleta')
        .update({
          dados_json: linhasEditando,
          total_final: linhasEditando.length,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', planilhaEditando.id);

      if (error) {
        throw error;
      }

      alert('Planilha atualizada com sucesso!');

      setPlanilhaEditando(null);
      setLinhasEditando([]);

      await carregarPlanilhas();
    } catch (error) {
      console.error('Erro ao salvar edição da planilha:', error);
      alert(error.message || 'Não foi possível salvar a planilha.');
    } finally {
      setSalvandoEdicao(false);
    }
  };

  const excluirPlanilha = async (item) => {
    if (!confirm(`Deseja excluir a planilha "${item.nome_arquivo || item.nome_arquivo_original}"?`)) return;

    try {
      const { error } = await supabase
        .from('planilhas_coleta')
        .delete()
        .eq('id', item.id);

      if (error) {
        throw error;
      }

      if (planilhaEditando?.id === item.id) {
        setPlanilhaEditando(null);
        setLinhasEditando([]);
      }

      await carregarPlanilhas();

      alert('Planilha excluída com sucesso!');
    } catch (error) {
      console.error('Erro ao excluir planilha:', error);
      alert(error.message || 'Não foi possível excluir a planilha.');
    }
  };

  const alterarStatusPlanilha = async (item, novoStatus) => {
    try {
      const { error } = await supabase
        .from('planilhas_coleta')
        .update({
          status: novoStatus,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', item.id);

      if (error) {
        throw error;
      }

      await carregarPlanilhas();
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      alert(error.message || 'Não foi possível alterar o status.');
    }
  };

  const competencias = Array.from(
    new Set(items.map(item => chaveCompetencia(item)))
  ).filter(Boolean);

  const itemsFiltrados = items.filter(item => {
    const texto = busca.toLowerCase().trim();
    const status = normalizarStatus(item.status);
    const competencia = chaveCompetencia(item);

    const passaStatus =
      filtroStatus === 'todos' ||
      status === filtroStatus;

    const passaCompetencia =
      filtroCompetencia === 'todas' ||
      competencia === filtroCompetencia;

    const passaBusca =
      !texto ||
      String(item.cliente_nome || '').toLowerCase().includes(texto) ||
      String(item.cnpj || '').toLowerCase().includes(texto) ||
      String(item.nome_arquivo || '').toLowerCase().includes(texto) ||
      String(item.nome_arquivo_original || '').toLowerCase().includes(texto) ||
      String(item.nome_arquivo_final || '').toLowerCase().includes(texto) ||
      String(formatarCompetenciaPlanilha(item)).toLowerCase().includes(texto);

    return passaStatus && passaCompetencia && passaBusca;
  });

  const gruposPorStatus = itemsFiltrados.reduce((acc, item) => {
    const status = normalizarStatus(item.status);

    acc[status] = acc[status] || [];
    acc[status].push(item);

    return acc;
  }, {});

  const totalPorStatus = (status) => {
    return items.filter(item => normalizarStatus(item.status) === status).length;
  };

  const totalLinhas = items.reduce((total, item) => {
    return total + (Number(item.total_final) || 0);
  }, 0);

  const totalDuplicidades = items.reduce((total, item) => {
    return total + (Number(item.duplicidades) || 0);
  }, 0);

  const pendentes = items.filter(item => {
    const status = normalizarStatus(item.status);

    return ['recebido', 'em_processamento'].includes(status);
  }).length;

  const limparFiltros = () => {
    setBusca('');
    setFiltroStatus('todos');
    setFiltroCompetencia('todas');
  };

  const MiniStat = ({ icon, label, value, color = '#D95F00', bg = '#FFF4EC' }) => (
    <div style={{
      background: '#fff',
      border: '1px solid var(--border)',
      borderRadius: '18px',
      padding: '14px',
      minWidth: isMobile ? '170px' : undefined,
      boxShadow: '0 10px 28px rgba(0,0,0,.04)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute',
        width: '90px',
        height: '90px',
        borderRadius: '50%',
        background: bg,
        right: '-34px',
        top: '-38px',
      }} />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{
          width: '38px',
          height: '38px',
          borderRadius: '13px',
          background: bg,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '18px',
        }}>
          {icon}
        </div>

        <div>
          <div style={{
            fontSize: '22px',
            fontWeight: 800,
            fontFamily: 'var(--mono)',
            color: 'var(--text)',
          }}>
            {value}
          </div>

          <div style={{
            fontSize: '11px',
            color: 'var(--muted)',
            marginTop: '2px',
          }}>
            {label}
          </div>
        </div>
      </div>
    </div>
  );

  const StatusBadge = ({ status }) => {
    const chave = normalizarStatus(status);
    const info = statusInfo[chave] || statusInfo.recebido;

    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        padding: '5px 9px',
        borderRadius: '999px',
        background: info.bg,
        border: `1px solid ${info.border}`,
        color: info.text,
        fontSize: '11px',
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}>
        <span>{info.icon}</span>
        {info.label}
      </span>
    );
  };

  const somenteVisualizacao = isConsult && !isAdmin && !isClient;

  return (
    <div>
      <div style={{
        background: isClient
          ? 'linear-gradient(135deg, #FFF4EC 0%, #FFFFFF 55%, #FFF8F1 100%)'
          : 'linear-gradient(135deg, #363638 0%, #4A4A4E 55%, #18171A 100%)',
        border: '1px solid var(--border)',
        borderRadius: '22px',
        padding: isMobile ? '16px' : '20px',
        marginBottom: '15px',
        color: isClient ? 'var(--text)' : '#fff',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute',
          width: '240px',
          height: '240px',
          borderRadius: '50%',
          background: isClient ? 'rgba(217,95,0,.10)' : 'rgba(255,255,255,.08)',
          right: '-90px',
          top: '-110px',
        }} />

        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: isMobile ? 'flex-start' : 'center',
          flexDirection: isMobile ? 'column' : 'row',
          gap: '12px',
          position: 'relative',
          zIndex: 1,
        }}>
          <div>
            <div style={{
              fontSize: isMobile ? '18px' : '22px',
              fontWeight: 800,
              marginBottom: '5px',
            }}>
              {isClient ? 'Minhas planilhas DICI' : 'Central de planilhas dos clientes'}
            </div>

            <div style={{
              fontSize: '13px',
              opacity: .82,
              lineHeight: 1.5,
              maxWidth: '720px',
            }}>
              {isClient
                ? 'Acompanhe suas coletas enviadas, baixe o CSV final e edite os dados quando necessário.'
                : 'Acompanhe as coletas recebidas, filtre por competência, altere o status e baixe os arquivos finais para lançamento.'}
            </div>
          </div>

          <div style={{
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
          }}>
            <Btn
              size="sm"
              variant={isClient ? 'primary' : 'gray'}
              onClick={carregarPlanilhas}
              disabled={carregando}
            >
              {carregando ? 'Atualizando...' : '↻ Atualizar'}
            </Btn>

            {isClient && (
              <Btn
                size="sm"
                variant="dark"
                onClick={() => window.dispatchEvent(new CustomEvent('scm-nav-dici'))}
              >
                Nova coleta
              </Btn>
            )}
          </div>
        </div>
      </div>

      <div style={{
        display: isMobile ? 'flex' : 'grid',
        gridTemplateColumns: isMobile ? undefined : 'repeat(4, 1fr)',
        gap: '11px',
        overflowX: isMobile ? 'auto' : undefined,
        marginBottom: '15px',
        paddingBottom: isMobile ? '4px' : undefined,
      }}>
        <MiniStat
          icon="📁"
          value={items.length}
          label="Planilhas recebidas"
          color="#0F6FA8"
          bg="#E6F3FF"
        />

        <MiniStat
          icon="⚠️"
          value={pendentes}
          label="Pendentes de análise"
          color="#B04D00"
          bg="#FFF4EC"
        />

        <MiniStat
          icon="📊"
          value={totalLinhas}
          label="Linhas finais"
          color="#363638"
          bg="#EBEBED"
        />

        <MiniStat
          icon="🔁"
          value={totalDuplicidades}
          label="Duplicidades somadas"
          color="#1E7E34"
          bg="#EAF7EE"
        />
      </div>

      <Card>
        <CardHead
          title="Filtros e acompanhamento"
          action={
            <div style={{ display: 'flex', gap: '7px', flexWrap: 'wrap' }}>
              <Btn size="sm" onClick={limparFiltros}>
                Limpar filtros
              </Btn>

              <Btn size="sm" variant="primary" onClick={carregarPlanilhas}>
                Atualizar
              </Btn>
            </div>
          }
        />

        <div style={{
          padding: '14px 16px',
          background: '#FAFAF8',
          borderBottom: '1px solid var(--border)',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1.4fr .8fr .8fr',
          gap: '10px',
        }}>
          <div>
            <div style={{
              fontSize: '11px',
              color: 'var(--muted)',
              marginBottom: '5px',
              fontWeight: 600,
            }}>
              Buscar cliente, CNPJ, arquivo ou competência
            </div>

            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Ex: R7, 0483816000100, Abril/2026..."
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                fontSize: '12px',
                outline: 'none',
                fontFamily: 'var(--font)',
                boxSizing: 'border-box',
                background: '#fff',
              }}
            />
          </div>

          <div>
            <div style={{
              fontSize: '11px',
              color: 'var(--muted)',
              marginBottom: '5px',
              fontWeight: 600,
            }}>
              Status
            </div>

            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                fontSize: '12px',
                outline: 'none',
                fontFamily: 'var(--font)',
                background: '#fff',
              }}
            >
              <option value="todos">Todos os status</option>
              {ordemStatus.map(status => (
                <option key={status} value={status}>
                  {statusInfo[status].label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div style={{
              fontSize: '11px',
              color: 'var(--muted)',
              marginBottom: '5px',
              fontWeight: 600,
            }}>
              Competência
            </div>

            <select
              value={filtroCompetencia}
              onChange={(e) => setFiltroCompetencia(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                fontSize: '12px',
                outline: 'none',
                fontFamily: 'var(--font)',
                background: '#fff',
              }}
            >
              <option value="todas">Todas as competências</option>

              {competencias.map(comp => {
                const exemplo = items.find(item => chaveCompetencia(item) === comp);

                return (
                  <option key={comp} value={comp}>
                    {exemplo ? formatarCompetenciaPlanilha(exemplo) : comp}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div style={{
          padding: '12px 16px',
          display: 'flex',
          gap: '8px',
          flexWrap: 'wrap',
          alignItems: 'center',
          borderBottom: '1px solid var(--border)',
        }}>
          {ordemStatus.map(status => (
            <button
              key={status}
              type="button"
              onClick={() => setFiltroStatus(filtroStatus === status ? 'todos' : status)}
              style={{
                border: `1px solid ${statusInfo[status].border}`,
                background: filtroStatus === status ? statusInfo[status].bg : '#fff',
                color: statusInfo[status].text,
                padding: '7px 10px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {statusInfo[status].icon}
              {statusInfo[status].label}
              <strong style={{ fontFamily: 'var(--mono)' }}>
                {totalPorStatus(status)}
              </strong>
            </button>
          ))}
        </div>

        {carregando && (
          <div style={{
            padding: '38px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '13px',
          }}>
            Carregando planilhas...
          </div>
        )}

        {erro && (
          <div style={{
            padding: '20px',
            color: 'var(--red)',
            fontSize: '13px',
          }}>
            {erro}
          </div>
        )}

        {!carregando && !erro && itemsFiltrados.length === 0 && (
          <div style={{
            padding: '42px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '13px',
            lineHeight: 1.5,
          }}>
            <div style={{ fontSize: '30px', marginBottom: '8px' }}>📂</div>
            Nenhuma planilha encontrada com os filtros atuais.
          </div>
        )}

        {!carregando && !erro && ordemStatus.map(status => {
          const lista = gruposPorStatus[status] || [];

          if (lista.length === 0) return null;

          const info = statusInfo[status];

          return (
            <div key={status}>
              <div style={{
                padding: '13px 16px',
                background: info.bg,
                borderTop: '1px solid var(--border)',
                borderBottom: `1px solid ${info.border}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '9px',
                  color: info.text,
                  fontWeight: 800,
                  fontSize: '13px',
                }}>
                  <span>{info.icon}</span>
                  {info.label}
                </div>

                <Pill
                  label={`${lista.length} ${lista.length === 1 ? 'planilha' : 'planilhas'}`}
                  color={info.color}
                />
              </div>

              <Tbl headers={[
                'Cliente',
                'CNPJ',
                'Arquivo',
                'Tipo',
                'Enviado em',
                'Linhas',
                'Duplic.',
                'Acessos',
                'Competência',
                'Status',
                'Ações'
              ]}>
                {lista.map(item => {
                  const statusAtual = normalizarStatus(item.status);
                  const linhas = obterLinhasPlanilha(item);
                  const acessos = contarAcessos(item);

                  return (
                    <TR key={item.id}>
                      <TD>
                        <div style={{ fontWeight: 700 }}>
                          {item.cliente_nome || 'Cliente não informado'}
                        </div>

                        <div style={{
                          fontSize: '11px',
                          color: 'var(--muted)',
                          marginTop: '2px',
                        }}>
                          {linhas.length} registro(s) no JSON
                        </div>
                      </TD>

                      <TD mono>
                        {formatarCnpj(item.cnpj || '') || item.cnpj || '—'}
                      </TD>

                      <TD>
                        <div style={{
                          maxWidth: '260px',
                          fontWeight: 600,
                          whiteSpace: 'normal',
                          lineHeight: 1.35,
                        }}>
                          {item.nome_arquivo_original || item.nome_arquivo || '—'}
                        </div>

                        {item.nome_arquivo_final && (
                          <div style={{
                            fontSize: '11px',
                            color: 'var(--muted)',
                            marginTop: '3px',
                          }}>
                            Final: {item.nome_arquivo_final}
                          </div>
                        )}
                      </TD>

                      <TD>
                        <Pill
                          label={item.tipo_arquivo || '—'}
                          color="gray"
                        />
                      </TD>

                      <TD mono style={{ whiteSpace: 'nowrap' }}>
                        {formatarData(item.criado_em)}
                      </TD>

                      <TD mono>
                        {item.total_original || 0} → <strong>{item.total_final || 0}</strong>
                      </TD>

                      <TD mono>
                        {item.duplicidades || 0}
                      </TD>

                      <TD mono>
                        {acessos || '—'}
                      </TD>

                      <TD>
                        <strong>{formatarCompetenciaPlanilha(item)}</strong>
                      </TD>

                      <TD>
                        {(isConsult || isAdmin) ? (
                          <select
                            value={statusAtual}
                            onChange={(e) => alterarStatusPlanilha(item, e.target.value)}
                            style={{
                              padding: '7px 9px',
                              border: `1px solid ${statusInfo[statusAtual]?.border || 'var(--border)'}`,
                              borderRadius: '10px',
                              fontSize: '12px',
                              fontFamily: 'var(--font)',
                              outline: 'none',
                              background: statusInfo[statusAtual]?.bg || '#fff',
                              color: statusInfo[statusAtual]?.text || 'var(--text)',
                              fontWeight: 700,
                              minWidth: '160px',
                            }}
                          >
                            <option value="recebido">Recebido</option>
                            <option value="em_processamento">Em processamento</option>
                            <option value="finalizado">Finalizado</option>
                            <option value="comprovante_anexado">Comprovante anexado</option>
                          </select>
                        ) : (
                          <StatusBadge status={statusAtual} />
                        )}
                      </TD>

                      <TD>
                        <div style={{
                          display: 'flex',
                          gap: '4px',
                          alignItems: 'center',
                        }}>
                          <ActBtn
                            variant="dl"
                            title="Baixar CSV"
                            onClick={() => baixarPlanilha(item)}
                          >
                            ⬇
                          </ActBtn>

                          <ActBtn
                            variant={somenteVisualizacao ? 'view' : 'edit'}
                            title={somenteVisualizacao ? 'Visualizar linhas' : 'Editar planilha'}
                            onClick={() => abrirEditorPlanilha(item)}
                          >
                            {somenteVisualizacao ? '◉' : '✎'}
                          </ActBtn>

                          {(isClient || isAdmin) && (
                            <ActBtn
                              variant="del"
                              title="Excluir planilha"
                              onClick={() => excluirPlanilha(item)}
                            >
                              ✕
                            </ActBtn>
                          )}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </Tbl>
            </div>
          );
        })}
      </Card>

      {planilhaEditando && (
        <Card>
          <CardHead
            title={`${somenteVisualizacao ? 'Visualizando' : 'Editando'} planilha — ${planilhaEditando.nome_arquivo || planilhaEditando.nome_arquivo_original}`}
            action={
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <Btn
                  size="sm"
                  onClick={() => {
                    setPlanilhaEditando(null);
                    setLinhasEditando([]);
                  }}
                >
                  Fechar
                </Btn>

                {!somenteVisualizacao && (
                  <Btn
                    variant="primary"
                    size="sm"
                    disabled={salvandoEdicao}
                    onClick={salvarEdicaoPlanilha}
                  >
                    {salvandoEdicao ? 'Salvando...' : 'Salvar alterações'}
                  </Btn>
                )}
              </div>
            }
          />

          <div style={{
            padding: '12px 16px',
            fontSize: '12px',
            color: 'var(--muted)',
            borderBottom: '1px solid var(--border)',
            lineHeight: 1.5,
            background: '#FAFAF8',
            display: 'flex',
            justifyContent: 'space-between',
            gap: '10px',
            flexWrap: 'wrap',
          }}>
            <span>
              {somenteVisualizacao
                ? 'Modo visualização para conferência dos dados enviados pelo cliente.'
                : 'Edite os campos abaixo e depois clique em Salvar alterações.'}
            </span>

            <strong>
              {linhasEditando.length} linha(s)
            </strong>
          </div>

          <Tbl headers={[
            '#',
            ...CSV_HEADERS.map(campo => HEADER_LABELS[campo] || campo),
            'Ações'
          ]}>
            {linhasEditando.map((linha, index) => (
              <TR key={index}>
                <TD mono>{index + 1}</TD>

                {CSV_HEADERS.map(campo => (
                  <TD key={campo}>
                    <input
                      value={linha[campo] || ''}
                      disabled={somenteVisualizacao}
                      onChange={(e) => atualizarLinhaEditando(index, campo, e.target.value)}
                      style={{
                        width: campo === 'CNPJ'
                          ? '125px'
                          : campo === 'TIPO_TECNOLOGIA'
                            ? '90px'
                            : '82px',
                        padding: '5px 7px',
                        border: '1px solid var(--border)',
                        borderRadius: '7px',
                        fontSize: '12px',
                        fontFamily: ['CNPJ', 'ANO', 'MES', 'COD_IBGE', 'VELOCIDADE', 'ACESSOS'].includes(campo)
                          ? 'var(--mono)'
                          : 'var(--font)',
                        outline: 'none',
                        background: somenteVisualizacao ? '#FAFAF8' : '#fff',
                        color: somenteVisualizacao ? 'var(--muted)' : 'var(--text)',
                      }}
                    />
                  </TD>
                ))}

                <TD>
                  {!somenteVisualizacao ? (
                    <ActBtn
                      variant="del"
                      title="Excluir linha"
                      onClick={() => excluirLinhaEditando(index)}
                    >
                      ✕
                    </ActBtn>
                  ) : (
                    <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
                      —
                    </span>
                  )}
                </TD>
              </TR>
            ))}
          </Tbl>

          {!somenteVisualizacao && (
            <button
              onClick={adicionarLinhaEditando}
              style={{
                width: '100%',
                padding: '11px',
                background: '#FEFCF9',
                border: 'none',
                borderTop: '1px dashed var(--border)',
                cursor: 'pointer',
                fontSize: '12px',
                color: 'var(--orange)',
                fontFamily: 'var(--font)',
                fontWeight: 700
              }}
            >
              + Adicionar linha
            </button>
          )}
        </Card>
      )}
    </div>
  );
}

/* ==============================
   ADMIN VIEWS
   ============================== */
function ViewUsuarios() {
  const { user } = useAuth();
  const isMobile = useMobile();

  const [filtroUsuarios, setFiltroUsuarios] = useState('');
  const [contas, setContas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [carregandoContas, setCarregandoContas] = useState(false);
  const [erro, setErro] = useState('');

  const carregarContas = useCallback(async () => {
    try {
      setCarregandoContas(true);
      setErro('');

      const { data, error } = await supabase
        .from('usuarios')
        .select('*')
        .order('criado_em', { ascending: false });

      if (error) throw error;

      setContas(data || []);
    } catch (error) {
      console.error('Erro ao carregar usuários no Supabase:', error);
      setErro(error.message || 'Erro ao carregar usuários.');
    } finally {
      setCarregandoContas(false);
    }
  }, []);

  const carregarClientesAdmin = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .order('criado_em', { ascending: false });

      if (error) throw error;

      setClientes(data || []);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
      setErro(error.message || 'Erro ao carregar clientes.');
    }
  }, []);

  useEffect(() => {
    carregarContas();
    carregarClientesAdmin();
  }, [carregarContas, carregarClientesAdmin]);

  const alterarConta = async (id, campo, valor) => {
    try {
      const { error } = await supabase
        .from('usuarios')
        .update({
          [campo]: valor,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      setContas(prev => prev.map(conta => {
        if (conta.id !== id) return conta;
        return { ...conta, [campo]: valor };
      }));
    } catch (error) {
      console.error('Erro ao alterar conta:', error);
      alert(error.message || 'Não foi possível alterar a conta.');
    }
  };

  const excluirConta = async (conta) => {
    if (conta.id === user?.id) {
      alert('Você não pode excluir sua própria conta enquanto está logado.');
      return;
    }

    if (!confirm(`Deseja excluir o perfil "${conta.nome}"?\n\nIsso remove o usuário da tabela usuarios. O registro em Authentication > Users deverá ser removido manualmente ou por Edge Function depois.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('usuarios')
        .delete()
        .eq('id', conta.id);

      if (error) throw error;

      await carregarContas();

      alert('Perfil removido com sucesso.');
    } catch (error) {
      console.error('Erro ao excluir conta:', error);
      alert(error.message || 'Não foi possível excluir a conta.');
    }
  };

  const contarClientesDoConsultor = (nomeConsultor) => {
    return clientes.filter(cliente => {
      return (cliente.consultor || '').toLowerCase().trim() === String(nomeConsultor || '').toLowerCase().trim();
    }).length;
  };

  const roleLabel = {
    admin: 'Administrador',
    consult: 'Consultor',
    client: 'Cliente',
  };

  const roleColor = {
    admin: 'black',
    consult: 'gray',
    client: 'orange',
  };

  const contasFiltradas = contas.filter(conta => {
    const textoBusca = filtroUsuarios.toLowerCase().trim();

    if (!textoBusca) return true;

    const nome = String(conta.nome || '').toLowerCase();
    const email = String(conta.email || '').toLowerCase();
    const role = String(conta.role || '').toLowerCase();
    const cnpj = String(conta.cnpj || '').toLowerCase();
    const status = conta.ativo === false ? 'inativo' : 'ativo';
    const perfilTraduzido = String(roleLabel[conta.role] || '').toLowerCase();

    return (
      nome.includes(textoBusca) ||
      email.includes(textoBusca) ||
      role.includes(textoBusca) ||
      perfilTraduzido.includes(textoBusca) ||
      cnpj.includes(textoBusca) ||
      status.includes(textoBusca)
    );
  });

  const contasAdmin = contas.filter(c => c.role === 'admin');
  const contasConsult = contas.filter(c => c.role === 'consult');
  const contasClient = contas.filter(c => c.role === 'client');

  const formatarData = (valor) => {
    if (!valor) return '—';
    return new Date(valor).toLocaleString('pt-BR');
  };
  const inputTabelaStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #E7E2DA',
    borderRadius: '10px',
    fontSize: '13px',
    fontFamily: 'var(--font)',
    outline: 'none',
    background: '#fff',
    transition: 'all .2s ease',
  };

  const selectTabelaStyle = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #E7E2DA',
    borderRadius: '10px',
    fontSize: '13px',
    fontFamily: 'var(--font)',
    outline: 'none',
    background: '#fff',
  };

  const miniLabelStyle = {
    fontSize: '11px',
    color: 'var(--muted)',
    marginBottom: '5px',
    display: 'block',
  };

  const cardInternoStyle = {
    background: '#FCFBF9',
    border: '1px solid #EEE7DE',
    borderRadius: '12px',
    padding: '10px',
  };

  const acoesWrapStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    justifyContent: 'center',
  };

  const emailTextoStyle = {
    fontSize: '12px',
    color: 'var(--muted)',
    marginTop: '4px',
    wordBreak: 'break-word',
  };

  const dataTextoStyle = {
    fontSize: '12px',
    color: 'var(--text)',
    lineHeight: 1.45,
  };

  const celulaCentralizada = {
    textAlign: 'center',
    verticalAlign: 'middle',
  };
  return (
    <div>
      <Banner
        role="admin"
        icon="🛡"
        title="Administração de usuários"
        sub="Gerencie contas, perfis, status de acesso e vínculos entre clientes e consultores."
      />

      <div style={{
        display: isMobile ? 'flex' : 'grid',
        gridTemplateColumns: isMobile ? undefined : 'repeat(4,1fr)',
        gap: '11px',
        overflowX: isMobile ? 'auto' : undefined,
        scrollSnapType: isMobile ? 'x mandatory' : undefined,
        WebkitOverflowScrolling: isMobile ? 'touch' : undefined,
        margin: isMobile ? '0 -12px 16px' : '0 0 16px',
        padding: isMobile ? '0 12px 4px' : undefined,
      }}>
        <StatCard value={contas.length} label="Contas cadastradas" accent="black" />
        <StatCard value={contasAdmin.length} label="Administradores" accent="black" />
        <StatCard value={contasConsult.length} label="Consultores" accent="gray" />
        <StatCard value={contasClient.length} label="Clientes" accent="orange" />
      </div>

      {erro && (
        <div style={{
          background: '#FFF0F0',
          border: '1px solid #F5C6C6',
          color: 'var(--red)',
          padding: '9px 12px',
          borderRadius: '7px',
          fontSize: '12px',
          marginBottom: '12px'
        }}>
          {erro}
        </div>
      )}

      <Card>
        <CardHead
          title="Monitoramento de contas e acessos"
          action={
            <div style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'center'
            }}>
              <input
                value={filtroUsuarios}
                onChange={(e) => setFiltroUsuarios(e.target.value)}
                placeholder="Filtrar por nome, e-mail, perfil, CNPJ..."
                style={{
                  width: '290px',
                  padding: '7px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  fontSize: '12px',
                  fontFamily: 'var(--font)',
                  outline: 'none',
                  background: '#fff'
                }}
              />

              {filtroUsuarios && (
                <Btn
                  size="sm"
                  onClick={() => setFiltroUsuarios('')}
                >
                  Limpar
                </Btn>
              )}

              <Btn
                variant="dark"
                size="sm"
                onClick={carregarContas}
              >
                Atualizar
              </Btn>
            </div>
          }
        />

        <div style={{
          padding: '9px 16px',
          borderBottom: '1px solid var(--border)',
          fontSize: '12px',
          color: 'var(--muted)',
          background: '#FAFAF8'
        }}>
          Exibindo <strong>{contasFiltradas.length}</strong> de <strong>{contas.length}</strong> conta(s).
        </div>

        {carregandoContas ? (
          <div style={{
            padding: '34px',
            textAlign: 'center',
            color: 'var(--muted)',
            fontSize: '13px'
          }}>
            Carregando usuários...
          </div>
        ) : (
          <Tbl headers={['Usuário', 'Perfil', 'CNPJ', 'Clientes vinculados', 'Criado em', 'Status', 'Ações']}>
            {contasFiltradas.map(conta => (
              <TR key={conta.id}>
                <TD style={{ minWidth: isMobile ? '200px' : '280px' }}>
                  <div style={cardInternoStyle}>
                    <label style={miniLabelStyle}>Nome</label>
                    <input
                      value={conta.nome || ''}
                      onChange={(e) => alterarConta(conta.id, 'nome', e.target.value)}
                      style={inputTabelaStyle}
                    />

                    <div style={{ marginTop: '8px' }}>
                      <label style={miniLabelStyle}>E-mail</label>
                      <input
                        value={conta.email || ''}
                        onChange={(e) => alterarConta(conta.id, 'email', e.target.value)}
                        style={inputTabelaStyle}
                      />
                    </div>
                  </div>
                </TD>

                <TD style={{ minWidth: isMobile ? '140px' : '180px' }}>
                  <div style={cardInternoStyle}>
                    <label style={miniLabelStyle}>Perfil</label>
                    <select
                      value={conta.role || 'client'}
                      onChange={(e) => alterarConta(conta.id, 'role', e.target.value)}
                      style={selectTabelaStyle}
                    >
                      <option value="admin">Administrador</option>
                      <option value="consult">Consultor</option>
                      <option value="client">Cliente</option>
                    </select>

                    <div style={{ marginTop: '10px' }}>
                      <Pill
                        label={roleLabel[conta.role] || conta.role}
                        color={roleColor[conta.role] || 'gray'}
                      />
                    </div>
                  </div>
                </TD>

                <TD style={{ minWidth: isMobile ? '150px' : '180px' }}>
                  <div style={cardInternoStyle}>
                    <label style={miniLabelStyle}>CNPJ</label>
                    <input
                      value={conta.cnpj || ''}
                      onChange={(e) => alterarConta(conta.id, 'cnpj', e.target.value.replace(/\D/g, ''))}
                      disabled={conta.role !== 'client'}
                      placeholder={conta.role === 'client' ? 'CNPJ do cliente' : 'Não se aplica'}
                      style={{
                        ...inputTabelaStyle,
                        fontFamily: 'var(--mono)',
                        background: conta.role === 'client' ? '#fff' : '#F4F1EC',
                        color: conta.role === 'client' ? 'var(--text)' : 'var(--faint)',
                      }}
                    />
                  </div>
                </TD>

                <TD style={celulaCentralizada}>
                  {conta.role === 'consult' ? (
                    <div style={{
                      display: 'inline-flex',
                      minWidth: '42px',
                      height: '42px',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: '12px',
                      background: '#F3F5F7',
                      border: '1px solid #E5E9EE',
                      fontWeight: 700,
                      fontSize: '14px',
                    }}>
                      {contarClientesDoConsultor(conta.nome)}
                    </div>
                  ) : (
                    <span style={{ color: 'var(--muted)', fontSize: '12px' }}>—</span>
                  )}
                </TD>

                <TD style={{ minWidth: isMobile ? '120px' : '150px' }}>
                  <div style={dataTextoStyle}>
                    {formatarData(conta.criado_em)}
                  </div>
                </TD>

                <TD style={celulaCentralizada}>
                  <Pill
                    label={conta.ativo === false ? 'Inativo' : 'Ativo'}
                    color={conta.ativo === false ? 'gray' : 'green'}
                  />
                </TD>

                <TD style={{ minWidth: '110px' }}>
                  <div style={acoesWrapStyle}>
                    <ActBtn
                      variant="edit"
                      title={conta.ativo === false ? 'Ativar conta' : 'Desativar conta'}
                      onClick={() => alterarConta(conta.id, 'ativo', !(conta.ativo !== false))}
                    >
                      {conta.ativo === false ? '▶' : '⏸'}
                    </ActBtn>

                    <ActBtn
                      variant="del"
                      title="Excluir perfil"
                      disabled={conta.id === user?.id}
                      onClick={() => excluirConta(conta)}
                    >
                      ✕
                    </ActBtn>
                  </div>
                </TD>
              </TR>
            ))}
          </Tbl>
        )}
      </Card>

      <Card>
        <CardHead title="Divisão de clientes por consultor" />

        <Tbl headers={['Consultor', 'E-mail', 'Clientes vinculados']}>
          {contasConsult.map(consultor => {
            const clientesDoConsultor = clientes.filter(cliente => {
              return (cliente.consultor || '').toLowerCase().trim() === String(consultor.nome || '').toLowerCase().trim();
            });

            return (
              <TR key={consultor.id}>
                <TD>
                  <strong>{consultor.nome}</strong>
                </TD>

                <TD>{consultor.email}</TD>

                <TD>
                  {clientesDoConsultor.length === 0 ? (
                    <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
                      Nenhum cliente vinculado
                    </span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                      {clientesDoConsultor.map(cliente => (
                        <Pill
                          key={cliente.id}
                          label={cliente.nome}
                          color="orange"
                        />
                      ))}
                    </div>
                  )}
                </TD>
              </TR>
            );
          })}
        </Tbl>
      </Card>

      <div style={{
        fontSize: '12px',
        color: 'var(--muted)',
        marginTop: '8px',
        lineHeight: 1.5
      }}>
        Observação: esta tela administra os perfis do sistema na tabela <strong>usuarios</strong>.
        A criação e exclusão completa no Supabase Auth será feita depois por Edge Function ou backend seguro.
      </div>
    </div>
  );
}
function ViewEditor() {
  const isMobile = useMobile();
  const [nome, setNome] = useState('SCM — Portal Regulatório');
  const [email, setEmail] = useState('contato@scmengenharia.com.br');
  const [mods, setMods] = useState({ dici: true, docs: true, vistoria: true, crea: false, rf: false });
  const [notifs, setNotifs] = useState({ email: true, prazo: true, wapp: false });
  return <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 250px', gap: '13px' }}>
    <div>
      <Card style={{ marginBottom: '13px' }}>
        <CardHead title="Prévia do portal" />
        <div style={{ padding: '14px', background: 'var(--bg)' }}>
          <div style={{ background: 'var(--orange)', borderRadius: '7px', padding: '10px 13px', marginBottom: '7px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '14px', color: '#fff', fontWeight: 500 }}>SCM</span>
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,.2)', borderRadius: '3px' }} />
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <div style={{ width: 68, background: 'var(--orange)', borderRadius: '5px', padding: '7px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[0, 1, 2, 3].map(i => <div key={i} style={{ height: 4, background: 'rgba(255,255,255,.3)', borderRadius: '2px' }} />)}
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[0, 1, 2].map(i => <div key={i} style={{ height: 20, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '5px' }} />)}
            </div>
          </div>
        </div>
      </Card>
      <Card>
        <CardHead title="Conteúdo e textos" />
        <div style={{ padding: '15px' }}>
          {[{ l: 'Nome do portal', v: nome, s: setNome }, { l: 'E-mail de contato', v: email, s: setEmail }].map(({ l, v, s }) => (
            <div key={l} style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '5px' }}>{l}</div>
              <input value={v} onChange={e => s(e.target.value)} style={{ width: '100%', padding: '7px 11px', border: '1px solid var(--border)', borderRadius: '7px', fontSize: '13px', fontFamily: 'var(--font)', outline: 'none', color: 'var(--text)' }}
                onFocus={e => e.target.style.borderColor = 'var(--orange)'} onBlur={e => e.target.style.borderColor = 'var(--border)'} />
            </div>
          ))}
          <Btn variant="primary" onClick={() => alert('Alterações salvas!')}>Salvar alterações</Btn>
        </div>
      </Card>
    </div>
    <div>
      <Card style={{ padding: '13px', marginBottom: '12px' }}>
        <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '11px' }}>Cores do portal</div>
        {[{ sw: '#D95F00', l: 'Cor principal', v: '#D95F00' }, { sw: '#18171A', l: 'Texto', v: '#18171A' }, { sw: '#F5F4F0', l: 'Fundo', v: '#F5F4F0' }].map(({ sw, l, v }) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <div style={{ width: 20, height: 20, borderRadius: '5px', background: sw, border: '1px solid var(--border)', flexShrink: 0 }} />
            <span style={{ fontSize: '12px', color: 'var(--muted)', flex: 1 }}>{l}</span>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--faint)' }}>{v}</span>
          </div>
        ))}
        <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--muted)', margin: '12px 0 8px' }}>Módulos ativos</div>
        <Toggle on={mods.dici} onChange={v => setMods(p => ({ ...p, dici: v }))} label="Coleta DICI" />
        <Toggle on={mods.docs} onChange={v => setMods(p => ({ ...p, docs: v }))} label="Documentos" />
        <Toggle on={mods.vistoria} onChange={v => setMods(p => ({ ...p, vistoria: v }))} label="Vistoria Mensal" />
        <Toggle on={mods.crea} onChange={v => setMods(p => ({ ...p, crea: v }))} label="Módulo CREA" />
        <Toggle on={mods.rf} onChange={v => setMods(p => ({ ...p, rf: v }))} label="Módulo RF" />
      </Card>
      <Card style={{ padding: '13px' }}>
        <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '10px' }}>Notificações</div>
        <Toggle on={notifs.email} onChange={v => setNotifs(p => ({ ...p, email: v }))} label="E-mail ao finalizar coleta" />
        <Toggle on={notifs.prazo} onChange={v => setNotifs(p => ({ ...p, prazo: v }))} label="Alerta de prazo (D-5)" />
        <Toggle on={notifs.wapp} onChange={v => setNotifs(p => ({ ...p, wapp: v }))} label="WhatsApp (em breve)" />
      </Card>
    </div>
  </div>;
}
function ViewConfiguracoes() {
  const isMobile = useMobile();
  const [config, setConfig] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('scm_config_admin') || '{}');
    } catch {
      return {};
    }
  });

  const atualizar = (campo, valor) => {
    setConfig(prev => {
      const novo = {
        ...prev,
        [campo]: valor,
      };

      localStorage.setItem('scm_config_admin', JSON.stringify(novo));

      return novo;
    });
  };

  return (
    <div>
      <Banner
        role="admin"
        icon="⚙"
        title="Configurações gerais do portal"
        sub="Controle módulos, preferências, alertas e opções administrativas da plataforma."
      />

      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        gap: '13px'
      }}>
        <Card>
          <CardHead title="Módulos habilitados" />

          <div style={{ padding: '15px' }}>
            <Toggle
              on={config.coletaDici !== false}
              onChange={(v) => atualizar('coletaDici', v)}
              label="Coleta DICI habilitada"
            />

            <Toggle
              on={config.planilhasClientes !== false}
              onChange={(v) => atualizar('planilhasClientes', v)}
              label="Planilhas dos clientes habilitada"
            />

            <Toggle
              on={config.comprovantes !== false}
              onChange={(v) => atualizar('comprovantes', v)}
              label="Comprovantes habilitado"
            />

            <Toggle
              on={config.usuarios !== false}
              onChange={(v) => atualizar('usuarios', v)}
              label="Gestão de usuários habilitada"
            />


          </div>
        </Card>

        <Card>
          <CardHead title="Alertas e prazos" />

          <div style={{ padding: '15px' }}>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: 'var(--muted)', marginBottom: '5px' }}>
                Dia limite da Coleta DICI
              </div>

              <input
                type="number"
                min="1"
                max="31"
                value={config.diaLimiteDici || 10}
                onChange={(e) => atualizar('diaLimiteDici', e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 11px',
                  border: '1px solid var(--border)',
                  borderRadius: '7px',
                  fontSize: '13px',
                  fontFamily: 'var(--font)',
                  outline: 'none',
                }}
              />
            </div>

            <Toggle
              on={config.alertaEmail !== false}
              onChange={(v) => atualizar('alertaEmail', v)}
              label="Enviar alerta por e-mail"
            />

            <Toggle
              on={config.alertaPrazo !== false}
              onChange={(v) => atualizar('alertaPrazo', v)}
              label="Alertar coletas próximas do prazo"
            />

            <Toggle
              on={config.bloquearClienteInativo === true}
              onChange={(v) => atualizar('bloquearClienteInativo', v)}
              label="Bloquear acesso de clientes inativos"
            />
          </div>
        </Card>

        <Card>
          <CardHead title="Permissões rápidas do administrador" />

          <div style={{ padding: '15px' }}>
            <Toggle
              on={true}
              onChange={() => alert('Administrador sempre possui acesso total.')}
              label="Editar usuários"
            />

            <Toggle
              on={true}
              onChange={() => alert('Administrador sempre possui acesso total.')}
              label="Excluir usuários"
            />

            <Toggle
              on={true}
              onChange={() => alert('Administrador sempre possui acesso total.')}
              label="Excluir planilhas dos clientes"
            />

            <Toggle
              on={true}
              onChange={() => alert('Administrador sempre possui acesso total.')}
              label="Alterar status das coletas"
            />

            <Toggle
              on={true}
              onChange={() => alert('Administrador sempre possui acesso total.')}
              label="Acessar configurações"
            />
          </div>
        </Card>

        <Card>
          <CardHead title="Informações do sistema" />

          <div style={{
            padding: '15px',
            fontSize: '12px',
            color: 'var(--muted)',
            lineHeight: 1.6
          }}>
            <div><strong>Banco:</strong> Supabase PostgreSQL</div>
            <div><strong>Autenticação:</strong> Supabase Auth</div>
            <div><strong>Perfis:</strong> admin, consult, client</div>
            <div><strong>Portal:</strong> SCM Engenharia</div>
            <div><strong>Status:</strong> ambiente em configuração</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
function ViewPermissoes() {
  const permsInit = [
    ['Ver painel', true, true, true], ['Editar própria coleta DICI', true, true, true],
    ['Ver coletas de todos os clientes', true, true, false], ['Baixar planilha DICI', true, true, false],
    ['Excluir dados de clientes', true, false, false], ['Gestão de usuários', true, false, false],
    ['Editor do site', true, false, false], ['Permissões', true, false, false],
    ['Log de auditoria', true, true, false], ['Relatórios globais', true, true, false],
  ];
  const [perms, setPerms] = useState(permsInit);
  return <Card>
    <CardHead title="Matriz de permissões por papel" action={<Btn variant="primary" size="sm" onClick={() => alert('Salvo!')}>Salvar</Btn>} />
    <div style={{ padding: '4px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', minWidth: '420px' }}>
        <thead><tr>
          <th style={{ padding: '8px 13px', textAlign: 'left', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--faint)', borderBottom: '1px solid var(--border)', background: '#FAFAF8' }}>Permissão</th>
          {['Administrador', 'Consultor', 'Cliente'].map(h => <th key={h} style={{ padding: '8px 13px', textAlign: 'center', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--faint)', borderBottom: '1px solid var(--border)', background: '#FAFAF8' }}>{h}</th>)}
        </tr></thead>
        <tbody>
          {perms.map(([l, a, c, cl], ri) => <tr key={ri}>
            <td style={{ padding: '7px 13px', borderBottom: '1px solid #F0EEE8' }}>{l}</td>
            {[a, c, cl].map((v, ci) => <td key={ci} style={{ padding: '7px 13px', borderBottom: '1px solid #F0EEE8', textAlign: 'center' }}>
              <span onClick={() => { if (ci === 0) return; const u = [...perms]; u[ri] = [...u[ri]]; u[ri][ci + 1] = !u[ri][ci + 1]; setPerms(u); }}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '4px', fontSize: '10px', fontWeight: 600, cursor: ci === 0 ? 'default' : 'pointer', background: v ? '#EAF7EE' : '#F5F4F0', color: v ? '#1E7E34' : 'var(--faint)' }}>{v ? '✓' : '✗'}</span>
            </td>)}
          </tr>)}
        </tbody>
      </table>
    </div>
    <div style={{ padding: '9px 13px', fontSize: '11px', color: 'var(--muted)', borderTop: '1px solid var(--border)' }}>
      Clique em ✓/✗ para alterar permissões de Consultor e Cliente. As do Administrador são fixas.
    </div>
  </Card>;
}



/* ==============================
   SUPERVISOR — STATUS HELPERS
   ============================== */
const SUPERVISOR_STATUS_INFO = {
  recebido:            { label: 'Recebido',         color: 'blue'   },
  em_processamento:    { label: 'Em processamento', color: 'orange' },
  finalizado:          { label: 'Finalizado',       color: 'gray'   },
  comprovante_anexado: { label: 'Com comprovante',  color: 'green'  },
};

function pillStatus(status) {
  const info = SUPERVISOR_STATUS_INFO[status] || { label: status || '—', color: 'gray' };
  return <Pill label={info.label} color={info.color} />;
}

function formatarDataBr(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

function competenciaSupervisor(item) {
  const meses = ['', 'Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const ano = Number(item?.competencia_ano);
  const mes = Number(item?.competencia_mes);
  if (ano && mes) return `${meses[mes] || String(mes).padStart(2,'0')}/${ano}`;
  return item?.competencia || '—';
}

function obterLinhasSupervisor(item) {
  let linhas = item?.dados_json || [];
  if (typeof linhas === 'string') {
    try { linhas = JSON.parse(linhas); } catch { linhas = []; }
  }
  return Array.isArray(linhas) ? linhas : [];
}

function baixarPlanilhaSupervisor(item) {
  try {
    const linhas = obterLinhasSupervisor(item);
    if (!linhas.length) { alert('Esta planilha não possui dados para baixar.'); return; }
    const headers = ['CNPJ','ANO','MES','COD_IBGE','TIPO_CLIENTE','TIPO_ATENDIMENTO','TIPO_MEIO','TIPO_PRODUTO','TIPO_TECNOLOGIA','VELOCIDADE','ACESSOS'];
    const csvEscape = (v) => {
      const s = String(v ?? '').replace(/\r?\n/g, ' ').trim();
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
    };
    const header = headers.join(';');
    const body = linhas.map(l => headers.map(h => csvEscape(l[h])).join(';')).join('\r\n');
    const conteudo = '﻿' + header + '\r\n' + body;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([conteudo], { type: 'text/csv;charset=utf-8;' }));
    const ano = item?.competencia_ano || (linhas[0]?.ANO) || '';
    const mes = item?.competencia_mes || (linhas[0]?.MES) || '';
    const empresa = (item?.cliente_nome || 'EMPRESA').replace(/[^a-zA-Z0-9_-]+/g, '_');
    a.download = item?.nome_arquivo_final || `COLETA_${empresa}_${ano}-${String(mes).padStart(2,'0')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    console.error('Erro ao baixar planilha (supervisor):', e);
    alert(e.message || 'Não foi possível baixar a planilha.');
  }
}

/* ==============================
   CONSULTOR — DASHBOARD
   Versão consultor do painel da supervisora: stat cards + filtros +
   pendências críticas e alertas, escopo restrito às empresas que o
   consultor logado atende (RLS já garante; aqui é defesa em profundidade
   e cálculo de empresas-sem-coleta-no-mês).
   ============================== */
function ViewConsultorDashboard() {
  const { user } = useAuth();

  const [clientes, setClientes] = useState([]);
  const [planilhas, setPlanilhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [erroCarga, setErroCarga] = useState('');

  const [filtroCompetencia, setFiltroCompetencia] = useState('todas');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [somentePendencias, setSomentePendencias] = useState(false);

  const STATUS_CONSULTOR = {
    recebido:            { label: 'Pendente lançamento', color: 'blue',   grupo: 'pendente' },
    em_processamento:    { label: 'Em andamento',        color: 'orange', grupo: 'andamento' },
    finalizado:          { label: 'Lançado',             color: 'green',  grupo: 'lancado' },
    comprovante_anexado: { label: 'Com comprovante',     color: 'green',  grupo: 'lancado' },
  };

  const normalizarStatusConsultor = (status) => {
    if (!status) return 'recebido';
    if (status === 'Importada') return 'recebido';
    return status;
  };

  const getStatusInfoConsultor = (status) => {
    const s = normalizarStatusConsultor(status);
    return STATUS_CONSULTOR[s] || { label: s || 'Sem status', color: 'gray', grupo: 'outro' };
  };

  const formatarDataConsultor = (valor) => {
    if (!valor) return '—';
    try {
      return new Date(valor).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const competenciaTextoConsultor = (item) => {
    const meses = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const ano = Number(item?.competencia_ano);
    const mes = Number(item?.competencia_mes);
    if (ano && mes) return `${meses[mes] || String(mes).padStart(2, '0')}/${ano}`;
    return item?.competencia || '—';
  };

  const diasDesdeConsultor = (valor) => {
    if (!valor) return 0;
    const data = new Date(valor);
    const diff = Date.now() - data.getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const normalizarNomeConsultorDash = (valor = '') => {
    return removerAcentos(String(valor || ''))
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  };

  const carregar = useCallback(async () => {
    try {
      setLoading(true);
      setErroCarga('');

      const nomeLogado = normalizarNomeConsultorDash(user?.nome || user?.name);

      const [clientesResp, planilhasResp] = await Promise.all([
        supabase
          .from('clientes')
          .select('id, usuario_id, nome, cnpj, consultor, status, email')
          .order('nome', { ascending: true }),

        supabase
          .from('planilhas_coleta')
          .select(`
            id,
            usuario_id,
            cnpj,
            cliente_nome,
            competencia,
            competencia_ano,
            competencia_mes,
            nome_arquivo,
            nome_arquivo_original,
            nome_arquivo_final,
            tipo_arquivo,
            total_original,
            total_final,
            duplicidades,
            status,
            criado_em,
            atualizado_em
          `)
          .order('criado_em', { ascending: false }),
      ]);

      if (clientesResp.error) throw clientesResp.error;
      if (planilhasResp.error) throw planilhasResp.error;

      // Defesa em profundidade: mesmo que RLS deixe vazar, filtro aqui.
const meusClientes = (clientesResp.data || []).filter(cliente => {
  return consultorPertenceAoUsuario(cliente.consultor, user);
});

const cnpjsDoConsultor = new Set(
  meusClientes
    .map(cliente => normalizarCnpj(cliente.cnpj))
    .filter(Boolean)
);

const usuariosDoConsultor = new Set(
  meusClientes
    .map(cliente => cliente.usuario_id)
    .filter(Boolean)
);

const minhasPlanilhas = (planilhasResp.data || []).filter(planilha => {
  const batePorCnpj = cnpjsDoConsultor.has(
    normalizarCnpj(planilha.cnpj)
  );

  const batePorUsuario = usuariosDoConsultor.has(
    planilha.usuario_id
  );

  return batePorCnpj || batePorUsuario;
});

      setClientes(meusClientes);
      setPlanilhas(minhasPlanilhas);
    } catch (error) {
      console.error('Erro ao carregar painel do consultor:', error);
      setErroCarga(error.message || 'Erro ao carregar painel do consultor.');
    } finally {
      setLoading(false);
    }
  }, [user?.nome, user?.name, user?.email]);

  useEffect(() => {
    let cancelado = false;
    let timeoutId = null;

    carregar();

    const agendarReload = () => {
      if (cancelado) return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!cancelado) carregar();
      }, 600);
    };

    const canal = supabase
      .channel('consultor-dashboard-tempo-real')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planilhas_coleta' }, agendarReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, agendarReload)
      .subscribe();

    return () => {
      cancelado = true;
      if (timeoutId) clearTimeout(timeoutId);
      supabase.removeChannel(canal);
    };
  }, [carregar]);

  const alterarStatus = async (item, novoStatus) => {
    try {
      setSaving(item.id);
      const { error } = await supabase
        .from('planilhas_coleta')
        .update({
          status: novoStatus,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', item.id);
      if (error) throw error;
      await carregar();
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      alert(error.message || 'Erro ao alterar status da planilha.');
    } finally {
      setSaving(null);
    }
  };

  const clientesPorCnpj = React.useMemo(() => {
    const mapa = new Map();
    clientes.forEach(c => {
      const cnpj = normalizarCnpj(c.cnpj);
      if (cnpj) mapa.set(cnpj, c);
    });
    return mapa;
  }, [clientes]);

  const planilhasComDados = React.useMemo(() => {
    return planilhas.map(planilha => {
      const cliente = clientesPorCnpj.get(normalizarCnpj(planilha.cnpj));
      const statusNormalizado = normalizarStatusConsultor(planilha.status);
      const statusInfo = getStatusInfoConsultor(statusNormalizado);
      return {
        ...planilha,
        statusNormalizado,
        statusInfo,
        cliente_nome_final: planilha.cliente_nome || cliente?.nome || 'Cliente não identificado',
        competenciaTexto: competenciaTextoConsultor(planilha),
        diasAguardando: diasDesdeConsultor(planilha.atualizado_em || planilha.criado_em),
      };
    });
  }, [planilhas, clientesPorCnpj]);

  const competencias = React.useMemo(() => {
    return [...new Set(planilhasComDados.map(p => p.competenciaTexto))]
      .filter(Boolean)
      .sort((a, b) => {
        const parse = (s) => {
          const meses = { Jan:1,Fev:2,Mar:3,Abr:4,Mai:5,Jun:6,Jul:7,Ago:8,Set:9,Out:10,Nov:11,Dez:12 };
          const m = String(s).match(/^([A-Za-zÀ-ÿ]+)\/(\d{4})$/);
          if (m) return Number(m[2]) * 100 + (meses[m[1]] || 0);
          const m2 = String(s).match(/^(\d{1,2})\/(\d{4})$/);
          if (m2) return Number(m2[2]) * 100 + Number(m2[1]);
          return 0;
        };
        return parse(b) - parse(a);
      });
  }, [planilhasComDados]);

  const planilhasFiltradas = React.useMemo(() => {
    return planilhasComDados.filter(item => {
      if (filtroCompetencia !== 'todas' && item.competenciaTexto !== filtroCompetencia) return false;
      if (filtroStatus !== 'todos' && item.statusNormalizado !== filtroStatus) return false;

      if (somentePendencias && ['finalizado', 'comprovante_anexado'].includes(item.statusNormalizado)) {
        return false;
      }

      if (busca.trim()) {
        const q = busca.trim().toLowerCase();
        const alvo = `
          ${item.cliente_nome_final || ''}
          ${item.cnpj || ''}
          ${item.nome_arquivo || ''}
          ${item.nome_arquivo_original || ''}
          ${item.competenciaTexto || ''}
        `.toLowerCase();
        if (!alvo.includes(q)) return false;
      }

      return true;
    });
  }, [planilhasComDados, filtroCompetencia, filtroStatus, somentePendencias, busca]);

  const totalEmpresas = clientes.length;
  const totalPlanilhas = planilhasFiltradas.length;
  const pendentesLancamento = planilhasFiltradas.filter(p => p.statusNormalizado === 'recebido').length;
  const emAndamento = planilhasFiltradas.filter(p => p.statusNormalizado === 'em_processamento').length;
  const lancadas = planilhasFiltradas.filter(p => ['finalizado', 'comprovante_anexado'].includes(p.statusNormalizado)).length;
  const taxaLancamento = totalPlanilhas > 0 ? Math.round((lancadas / totalPlanilhas) * 100) : 0;

  // Empresas que ainda não enviaram coleta na competência atual.
  const empresasSemColetaMesAtual = React.useMemo(() => {
    const agora = new Date();
    const anoAtual = agora.getFullYear();
    const mesAtual = agora.getMonth() + 1;

    const cnpjsComColeta = new Set(
      planilhas
        .filter(p => Number(p.competencia_ano) === anoAtual && Number(p.competencia_mes) === mesAtual)
        .map(p => normalizarCnpj(p.cnpj))
    );

    return clientes.filter(c => !cnpjsComColeta.has(normalizarCnpj(c.cnpj)));
  }, [clientes, planilhas]);

  const pendenciasCriticas = React.useMemo(() => {
    return planilhasFiltradas
      .filter(item => ['recebido', 'em_processamento'].includes(item.statusNormalizado))
      .filter(item => item.diasAguardando >= 3)
      .sort((a, b) => b.diasAguardando - a.diasAguardando);
  }, [planilhasFiltradas]);

  const ultimasPendencias = React.useMemo(() => {
    return planilhasFiltradas
      .filter(item => ['recebido', 'em_processamento'].includes(item.statusNormalizado))
      .sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0))
      .slice(0, 15);
  }, [planilhasFiltradas]);
const graficoConsultorPorCompetencia = React.useMemo(() => {
  const mapa = new Map();

  planilhasFiltradas.forEach(planilha => {
    const chave = planilha.competenciaTexto || 'Sem competência';

    if (!mapa.has(chave)) {
      mapa.set(chave, {
        competencia: chave,
        total: 0,
        recebido: 0,
        em_processamento: 0,
        finalizado: 0,
        comprovante_anexado: 0,
        lancadas: 0,
        pendentes: 0,
      });
    }

    const item = mapa.get(chave);
    item.total += 1;

    if (item[planilha.statusNormalizado] !== undefined) {
      item[planilha.statusNormalizado] += 1;
    }

    if (['recebido', 'em_processamento'].includes(planilha.statusNormalizado)) {
      item.pendentes += 1;
    }

    if (['finalizado', 'comprovante_anexado'].includes(planilha.statusNormalizado)) {
      item.lancadas += 1;
    }
  });

  return [...mapa.values()].sort((a, b) => {
    return b.total - a.total;
  });
}, [planilhasFiltradas]);

const maiorTotalGraficoConsultor = Math.max(
  ...graficoConsultorPorCompetencia.map(item => item.total),
  1
);
  if (loading) {
    return <Empty msg="Carregando painel..." sub="Buscando suas empresas e coletas." icon="📊" />;
  }

  if (erroCarga) {
    return (
      <Card>
        <CardHead title="Erro ao carregar o painel" action={
          <Btn size="sm" onClick={carregar}>Tentar novamente</Btn>
        } />
        <div style={{ padding: 16, fontSize: 13, color: 'var(--red)' }}>
          {erroCarga}
        </div>
      </Card>
    );
  }

  const inputFiltroStyle = {
    padding: '9px 10px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    fontSize: '12px',
    fontFamily: 'var(--font)',
    outline: 'none',
    background: '#fff',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div className="scm-fade-in">
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '12px',
        marginBottom: '14px',
      }}>
        <StatCard value={totalEmpresas} label="Minhas empresas" accent="gray" />
        <StatCard value={totalPlanilhas} label="Planilhas no filtro" accent="black" />
        <StatCard value={pendentesLancamento} label="Pendentes de lançamento" accent="orange" />
        <StatCard value={emAndamento} label="Em processamento" accent="blue" />
        <StatCard value={lancadas} label="Já lançadas" accent="green" />
        <StatCard value={`${taxaLancamento}%`} label="Taxa de lançamento" accent="green" />
      </div>

      <Card>
        <CardHead
          title="Filtros do consultor"
          
          action={
            <Btn size="sm" onClick={carregar}>
              Atualizar
            </Btn>
          }
        />

        <div style={{
          padding: '14px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '10px',
          alignItems: 'end',
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
              Buscar
            </div>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Empresa, CNPJ ou arquivo..."
              style={inputFiltroStyle}
            />
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
              Competência
            </div>
            <select
              value={filtroCompetencia}
              onChange={(e) => setFiltroCompetencia(e.target.value)}
              style={inputFiltroStyle}
            >
              <option value="todas">Todas</option>
              {competencias.map(comp => (
                <option key={comp} value={comp}>{comp}</option>
              ))}
            </select>
          </div>

          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
              Status
            </div>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              style={inputFiltroStyle}
            >
              <option value="todos">Todos</option>
              <option value="recebido">Pendente lançamento</option>
              <option value="em_processamento">Em processamento</option>
              <option value="finalizado">Lançado</option>
              <option value="comprovante_anexado">Com comprovante</option>
            </select>
          </div>

          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            fontSize: '12px',
            color: 'var(--muted)',
            padding: '9px 10px',
            border: '1px solid var(--border)',
            borderRadius: '10px',
            background: '#FAFAF8',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={somentePendencias}
              onChange={(e) => setSomentePendencias(e.target.checked)}
            />
            Mostrar só pendências
          </label>
        </div>
      </Card>
      <Card>
  <CardHead
    title="Gráfico do consultor — coletas por competência"
    action={
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>

      </div>
    }
  />

  <div style={{ padding: '16px' }}>
    {graficoConsultorPorCompetencia.length === 0 ? (
      <Empty
        msg="Nenhuma coleta encontrada"
        sub="Quando os clientes vinculados a você enviarem planilhas, elas aparecerão aqui."
        icon="📊"
      />
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {graficoConsultorPorCompetencia.map(item => {
          const larguraTotal = Math.max(
            (item.total / maiorTotalGraficoConsultor) * 100,
            8
          );

          const pctRecebido = item.total
            ? (item.recebido / item.total) * 100
            : 0;

          const pctProc = item.total
            ? (item.em_processamento / item.total) * 100
            : 0;

          const pctLancado = item.total
            ? (item.lancadas / item.total) * 100
            : 0;

          return (
            <div
              key={item.competencia}
              style={{
                border: '1px solid var(--border)',
                borderRadius: '16px',
                padding: '13px',
                background: item.pendentes > 0 ? '#FFFCF8' : '#FAFAF8',
              }}
            >
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                flexWrap: 'wrap',
                marginBottom: '9px',
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {item.competencia}
                  </div>

                  <div style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    marginTop: 4,
                  }}>
                    {item.total} planilha(s) · {item.lancadas} lançada(s) · {item.pendentes} pendente(s)
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <Pill label={`Pendentes ${item.recebido}`} color="blue" />
                  <Pill label={`Andamento ${item.em_processamento}`} color="orange" />
                  <Pill label={`Lançadas ${item.lancadas}`} color="green" />
                </div>
              </div>

              <div style={{
                height: 18,
                width: '100%',
                background: '#EFEDE8',
                borderRadius: 'var(--r-pill)',
                overflow: 'hidden',
                border: '1px solid var(--border)',
              }}>
                <div style={{
                  width: `${larguraTotal}%`,
                  height: '100%',
                  display: 'flex',
                  transition: 'width .25s ease',
                }}>
                  <div
                    title={`Pendentes: ${item.recebido}`}
                    style={{
                      width: `${pctRecebido}%`,
                      background: '#6BB7E8',
                    }}
                  />

                  <div
                    title={`Em processamento: ${item.em_processamento}`}
                    style={{
                      width: `${pctProc}%`,
                      background: '#F2A154',
                    }}
                  />

                  <div
                    title={`Lançadas: ${item.lancadas}`}
                    style={{
                      width: `${pctLancado}%`,
                      background: '#4CA86A',
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
</Card>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '14px',
      }}>
        <Card>
          <CardHead title="Alertas essenciais" />

          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill
                label={`${empresasSemColetaMesAtual.length}`}
                color={empresasSemColetaMesAtual.length > 0 ? 'orange' : 'green'}
              />
              <span style={{ fontSize: 12 }}>empresa(s) sem coleta no mês atual</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill
                label={`${pendenciasCriticas.length}`}
                color={pendenciasCriticas.length > 0 ? 'red' : 'green'}
              />
              <span style={{ fontSize: 12 }}>coleta(s) paradas há 3 dias ou mais</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill
                label={`${pendentesLancamento}`}
                color={pendentesLancamento > 0 ? 'orange' : 'green'}
              />
              <span style={{ fontSize: 12 }}>planilha(s) aguardando lançamento</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill label={`${taxaLancamento}%`} color={taxaLancamento >= 80 ? 'green' : 'orange'} />
              <span style={{ fontSize: 12 }}>taxa de lançamento no filtro</span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Empresas sem coleta no mês atual" />

          {empresasSemColetaMesAtual.length === 0 ? (
            <div style={{ padding: 14, fontSize: 12, color: 'var(--green)' }}>
              ✅ Todas as suas empresas já enviaram coleta este mês.
            </div>
          ) : (
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 240, overflowY: 'auto' }}>
              {empresasSemColetaMesAtual.map(c => (
                <div key={c.id} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '8px 10px', border: '1px solid var(--border)',
                  borderRadius: 10, background: '#FFFCF8',
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.nome}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)', marginTop: 2 }}>
                      {c.cnpj || '—'}
                    </div>
                  </div>
                  <Pill label="Sem coleta" color="orange" />
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {pendenciasCriticas.length > 0 && (
        <Card>
          <CardHead title="⚠ Coletas paradas há 3 dias ou mais" />

          <Tbl headers={[
            'Cliente',
            'CNPJ',
            'Competência',
            'Arquivo',
            'Status',
            'Dias aguardando',
            'Recebido em',
            'Ações',
          ]}>
            {pendenciasCriticas.map(item => (
              <TR key={item.id}>
                <TD>
                  <strong>{item.cliente_nome_final}</strong>
                </TD>
                <TD mono>{item.cnpj || '—'}</TD>
                <TD>{item.competenciaTexto}</TD>
                <TD>
                  <div style={{ fontWeight: 500 }}>
                    {item.nome_arquivo || item.nome_arquivo_original || '—'}
                  </div>
                </TD>
                <TD>
                  <Pill label={item.statusInfo.label} color={item.statusInfo.color} />
                </TD>
                <TD>
                  <Pill
                    label={`${item.diasAguardando} dia(s)`}
                    color={item.diasAguardando >= 7 ? 'red' : 'orange'}
                  />
                </TD>
                <TD mono>{formatarDataConsultor(item.criado_em)}</TD>
                <TD>
                  <ActBtn
                    variant="edit"
                    title="Marcar em processamento"
                    disabled={saving === item.id || item.statusNormalizado === 'em_processamento'}
                    onClick={() => alterarStatus(item, 'em_processamento')}
                  >
                    ▶
                  </ActBtn>
                  <ActBtn
                    variant="edit"
                    title="Marcar como lançado"
                    disabled={saving === item.id || item.statusNormalizado === 'finalizado'}
                    onClick={() => alterarStatus(item, 'finalizado')}
                  >
                    ✓
                  </ActBtn>
                </TD>
              </TR>
            ))}
          </Tbl>
        </Card>
      )}

      <Card>
        <CardHead title="Pendências de lançamento" />

        {ultimasPendencias.length === 0 ? (
          <Empty
            msg="Nenhuma pendência encontrada"
            sub="Todas as planilhas do filtro atual já foram lançadas ou estão com comprovante."
            icon="✅"
          />
        ) : (
          <Tbl headers={[
            'Cliente',
            'CNPJ',
            'Competência',
            'Arquivo',
            'Status',
            'Dias aguardando',
            'Recebido em',
            'Ações',
          ]}>
            {ultimasPendencias.map(item => (
              <TR key={item.id}>
                <TD>
                  <strong>{item.cliente_nome_final}</strong>
                </TD>
                <TD mono>{item.cnpj || '—'}</TD>
                <TD>{item.competenciaTexto}</TD>
                <TD>
                  <div style={{ fontWeight: 500 }}>
                    {item.nome_arquivo || item.nome_arquivo_original || '—'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    Final: {item.nome_arquivo_final || '—'}
                  </div>
                </TD>
                <TD>
                  <Pill label={item.statusInfo.label} color={item.statusInfo.color} />
                </TD>
                <TD>
                  <Pill
                    label={`${item.diasAguardando} dia(s)`}
                    color={item.diasAguardando >= 3 ? 'red' : 'gray'}
                  />
                </TD>
                <TD mono>{formatarDataConsultor(item.criado_em)}</TD>
                <TD>
                  <ActBtn
                    variant="edit"
                    title="Marcar em processamento"
                    disabled={saving === item.id || item.statusNormalizado === 'em_processamento'}
                    onClick={() => alterarStatus(item, 'em_processamento')}
                  >
                    ▶
                  </ActBtn>
                  <ActBtn
                    variant="edit"
                    title="Marcar como lançado"
                    disabled={saving === item.id || item.statusNormalizado === 'finalizado'}
                    onClick={() => alterarStatus(item, 'finalizado')}
                  >
                    ✓
                  </ActBtn>
                </TD>
              </TR>
            ))}
          </Tbl>
        )}
      </Card>
    </div>
  );
}

function GraficoPizzaConsultores({ dados = [] }) {
  const dadosComPlanilhas = dados.filter(item => Number(item.total) > 0);
  const totalGeral = dadosComPlanilhas.reduce((total, item) => total + Number(item.total || 0), 0);

  const cores = [
    '#0F6FA8',
    '#D95F00',
    '#1E7E34',
    '#6F42C1',
    '#C0392B',
    '#34495E',
    '#F2A154',
    '#4CA86A',
  ];

  if (!dadosComPlanilhas.length || totalGeral === 0) {
    return (
      <Empty
        msg="Sem dados para exibir"
        sub="Nenhuma coleta encontrada nos filtros atuais."
        icon="📊"
      />
    );
  }

  let acumulado = 0;

  const fatias = dadosComPlanilhas.map((item, index) => {
    const valor = Number(item.total || 0);
    const inicio = acumulado;
    const fim = acumulado + (valor / totalGeral) * 100;

    acumulado = fim;

    return {
      ...item,
      valor,
      inicio,
      fim,
      cor: cores[index % cores.length],
      percentual: Math.round((valor / totalGeral) * 100),
    };
  });

  const backgroundPizza = fatias
    .map(fatia => `${fatia.cor} ${fatia.inicio}% ${fatia.fim}%`)
    .join(', ');

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(240px, 340px) 1fr',
      gap: '22px',
      alignItems: 'center',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}>
        <div style={{
          width: 260,
          height: 260,
          borderRadius: '50%',
          background: `conic-gradient(${backgroundPizza})`,
          position: 'relative',
          boxShadow: '0 18px 35px rgba(0,0,0,.12)',
          border: '1px solid var(--border)',
        }}>
          <div style={{
            position: 'absolute',
            inset: 54,
            borderRadius: '50%',
            background: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            boxShadow: 'inset 0 0 0 1px var(--border)',
          }}>
            <div style={{
              fontSize: 30,
              fontWeight: 800,
              fontFamily: 'var(--mono)',
              color: 'var(--text)',
              lineHeight: 1,
            }}>
              {totalGeral}
            </div>

            <div style={{
              fontSize: 11,
              color: 'var(--muted)',
              marginTop: 5,
              textTransform: 'uppercase',
              letterSpacing: '.06em',
              fontWeight: 600,
              textAlign: 'center',
            }}>
              planilhas
            </div>
          </div>
        </div>
      </div>

      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 0,
      }}>
        {fatias.map(fatia => (
          <div
            key={fatia.consultor}
            style={{
              border: '1px solid var(--border)',
              borderRadius: '14px',
              padding: '11px 12px',
              background: fatia.pendentes > 0 ? '#FFFCF8' : '#FAFAF8',
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: '10px',
              alignItems: 'center',
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}>
                <span style={{
                  width: 11,
                  height: 11,
                  borderRadius: '50%',
                  background: fatia.cor,
                  display: 'inline-block',
                  flexShrink: 0,
                }} />

                <strong style={{
                  fontSize: 13,
                  color: 'var(--text)',
                }}>
                  {fatia.consultor}
                </strong>

                {fatia.consultor === 'Sem consultor' && (
                  <Pill label="Atenção" color="red" />
                )}
              </div>

              <div style={{
                fontSize: 11,
                color: 'var(--muted)',
                marginTop: 5,
              }}>
                {fatia.empresas} empresa(s) · {fatia.total} planilha(s) · {fatia.percentual}% do total
              </div>

              <div style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                marginTop: 8,
              }}>
                <Pill label={`Pendentes ${fatia.recebido}`} color="blue" />
                <Pill label={`Andamento ${fatia.em_processamento}`} color="orange" />
                <Pill label={`Lançadas ${fatia.lancadas}`} color="green" />
              </div>
            </div>

            <div style={{
              fontSize: 20,
              fontWeight: 800,
              fontFamily: 'var(--mono)',
              color: fatia.cor,
              textAlign: 'right',
              minWidth: 48,
            }}>
              {fatia.percentual}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==============================
   SUPERVISOR — DASHBOARD
   ============================== */
function ViewSupervisorDashboard() {
  const [clientes, setClientes] = useState([]);
  const [consultores, setConsultores] = useState([]);
  const [planilhas, setPlanilhas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [erroCarga, setErroCarga] = useState('');

  const [filtroConsultor, setFiltroConsultor] = useState('todos');
  const [filtroCompetencia, setFiltroCompetencia] = useState('todas');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [busca, setBusca] = useState('');
  const [somentePendencias, setSomentePendencias] = useState(false);

  const STATUS_SUPERVISOR = {
    recebido: {
      label: 'Pendente lançamento',
      color: 'blue',
      grupo: 'pendente',
    },
    em_processamento: {
      label: 'Em andamento',
      color: 'orange',
      grupo: 'andamento',
    },
    finalizado: {
      label: 'Lançado',
      color: 'green',
      grupo: 'lancado',
    },
    comprovante_anexado: {
      label: 'Com comprovante',
      color: 'green',
      grupo: 'lancado',
    },
  };

  const normalizarStatusSupervisor = (status) => {
    if (!status) return 'recebido';
    if (status === 'Importada') return 'recebido';
    return status;
  };

  const getStatusInfo = (status) => {
    const s = normalizarStatusSupervisor(status);
    return STATUS_SUPERVISOR[s] || {
      label: s || 'Sem status',
      color: 'gray',
      grupo: 'outro',
    };
  };

  const formatarDataSupervisor = (valor) => {
    if (!valor) return '—';

    try {
      return new Date(valor).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const competenciaTextoSupervisor = (item) => {
    const meses = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    const ano = Number(item?.competencia_ano);
    const mes = Number(item?.competencia_mes);

    if (ano && mes) {
      return `${meses[mes] || String(mes).padStart(2, '0')}/${ano}`;
    }

    return item?.competencia || '—';
  };

  const diasDesde = (valor) => {
    if (!valor) return 0;

    const data = new Date(valor);
    const diff = Date.now() - data.getTime();

    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  const carregar = useCallback(async () => {
    try {
      setLoading(true);
      setErroCarga('');

const [clientesResp, consultoresResp, planilhasResp] = await Promise.all([
  supabase
    .from('clientes')
    .select('id, usuario_id, nome, cnpj, consultor, status, email')
    .order('nome', { ascending: true }),

  supabase
    .from('usuarios')
    .select('id, nome, email, role, ativo')
    .eq('role', 'consult')
    .eq('ativo', true)
    .order('nome', { ascending: true }),

  supabase
    .from('planilhas_coleta')
    .select(`
      id,
      usuario_id,
      cnpj,
      cliente_nome,
      competencia,
      competencia_ano,
      competencia_mes,
      nome_arquivo,
      nome_arquivo_original,
      nome_arquivo_final,
      tipo_arquivo,
      total_original,
      total_final,
      duplicidades,
      status,
      criado_em,
      atualizado_em
    `)
    .order('criado_em', { ascending: false }),
]);

      if (clientesResp.error) throw clientesResp.error;
      if (consultoresResp.error) throw consultoresResp.error;
      if (planilhasResp.error) throw planilhasResp.error;

      setClientes(clientesResp.data || []);
      setConsultores(consultoresResp.data || []);
      setPlanilhas(planilhasResp.data || []);
    } catch (error) {
      console.error('Erro ao carregar painel da supervisora:', error);
      setErroCarga(error.message || 'Erro ao carregar painel da supervisora.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelado = false;
    let timeoutId = null;

    carregar();

    // Debounce do realtime: evita reload em rajada quando várias linhas
    // mudam ao mesmo tempo (ex.: import em lote).
    const agendarReload = () => {
      if (cancelado) return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (!cancelado) carregar();
      }, 600);
    };

    const canal = supabase
      .channel('supervisor-dashboard-tempo-real')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planilhas_coleta' }, agendarReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, agendarReload)
      .subscribe();

    return () => {
      cancelado = true;
      if (timeoutId) clearTimeout(timeoutId);
      supabase.removeChannel(canal);
    };
  }, [carregar]);

  const alterarStatus = async (item, novoStatus) => {
    try {
      setSaving(item.id);

      const { error } = await supabase
        .from('planilhas_coleta')
        .update({
          status: novoStatus,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', item.id);

      if (error) throw error;

      await carregar();
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      alert(error.message || 'Erro ao alterar status da planilha.');
    } finally {
      setSaving(null);
    }
  };

const normalizarNomeBusca = (valor = '') => {
  return removerAcentos(String(valor || ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

const clientesPorCnpj = React.useMemo(() => {
  const mapa = new Map();

  clientes.forEach(cliente => {
    const cnpj = normalizarCnpj(cliente.cnpj);

    if (cnpj) {
      mapa.set(cnpj, cliente);
    }
  });

  return mapa;
}, [clientes]);

const clientesPorUsuarioId = React.useMemo(() => {
  const mapa = new Map();

  clientes.forEach(cliente => {
    if (cliente.usuario_id) {
      mapa.set(cliente.usuario_id, cliente);
    }
  });

  return mapa;
}, [clientes]);

const clientesPorNome = React.useMemo(() => {
  const mapa = new Map();

  clientes.forEach(cliente => {
    const nome = normalizarNomeBusca(cliente.nome);

    if (nome) {
      mapa.set(nome, cliente);
    }
  });

  return mapa;
}, [clientes]);

const encontrarClienteDaPlanilha = useCallback((planilha) => {
  const porCnpj = clientesPorCnpj.get(normalizarCnpj(planilha.cnpj));

  if (porCnpj) {
    return porCnpj;
  }

  const porUsuario = clientesPorUsuarioId.get(planilha.usuario_id);

  if (porUsuario) {
    return porUsuario;
  }

  const porNome = clientesPorNome.get(normalizarNomeBusca(planilha.cliente_nome));

  if (porNome) {
    return porNome;
  }

  return null;
}, [clientesPorCnpj, clientesPorUsuarioId, clientesPorNome]);

  const planilhasComDados = React.useMemo(() => {
    return planilhas.map(planilha => {
      const cliente = encontrarClienteDaPlanilha(planilha);
const statusNormalizado = normalizarStatusSupervisor(planilha.status);
const statusInfo = getStatusInfo(statusNormalizado);
const consultor = cliente?.consultor?.trim() || 'Sem consultor';

      return {
        ...planilha,
        statusNormalizado,
        statusInfo,
        consultor,
        cliente_nome_final: planilha.cliente_nome || cliente?.nome || 'Cliente não identificado',
        competenciaTexto: competenciaTextoSupervisor(planilha),
        diasAguardando: diasDesde(planilha.atualizado_em || planilha.criado_em),
      };
    });
}, [planilhas, encontrarClienteDaPlanilha]);

  const competencias = React.useMemo(() => {
    // Ordena por (ano, mês) DESC para mostrar competências mais recentes primeiro.
    return [...new Set(planilhasComDados.map(p => p.competenciaTexto))]
      .filter(Boolean)
      .sort((a, b) => {
        const parse = (s) => {
          const meses = { Jan:1,Fev:2,Mar:3,Abr:4,Mai:5,Jun:6,Jul:7,Ago:8,Set:9,Out:10,Nov:11,Dez:12 };
          const m = String(s).match(/^([A-Za-zÀ-ÿ]+)\/(\d{4})$/);
          if (m) return Number(m[2]) * 100 + (meses[m[1]] || 0);
          const m2 = String(s).match(/^(\d{1,2})\/(\d{4})$/);
          if (m2) return Number(m2[2]) * 100 + Number(m2[1]);
          return 0;
        };
        return parse(b) - parse(a);
      });
  }, [planilhasComDados]);

  const consultoresFiltro = React.useMemo(() => ([
    'Sem consultor',
    ...consultores.map(c => c.nome),
  ]), [consultores]);

  const planilhasFiltradas = React.useMemo(() => {
    return planilhasComDados.filter(item => {
      if (filtroConsultor !== 'todos' && item.consultor !== filtroConsultor) return false;
      if (filtroCompetencia !== 'todas' && item.competenciaTexto !== filtroCompetencia) return false;
      if (filtroStatus !== 'todos' && item.statusNormalizado !== filtroStatus) return false;

      if (somentePendencias && ['finalizado', 'comprovante_anexado'].includes(item.statusNormalizado)) {
        return false;
      }

      if (busca.trim()) {
        const q = busca.trim().toLowerCase();

        const alvo = `
          ${item.cliente_nome_final || ''}
          ${item.cnpj || ''}
          ${item.consultor || ''}
          ${item.nome_arquivo || ''}
          ${item.nome_arquivo_original || ''}
          ${item.competenciaTexto || ''}
        `.toLowerCase();

        if (!alvo.includes(q)) return false;
      }

      return true;
    });
  }, [planilhasComDados, filtroConsultor, filtroCompetencia, filtroStatus, somentePendencias, busca]);

  const totalPlanilhas = planilhasFiltradas.length;
  const pendentesLancamento = planilhasFiltradas.filter(p => p.statusNormalizado === 'recebido').length;
  const emAndamento = planilhasFiltradas.filter(p => p.statusNormalizado === 'em_processamento').length;
  const lancadas = planilhasFiltradas.filter(p => ['finalizado', 'comprovante_anexado'].includes(p.statusNormalizado)).length;
  const empresasSemConsultor = clientes.filter(c => !c.consultor || !c.consultor.trim()).length;

  const taxaLancamento = totalPlanilhas > 0
    ? Math.round((lancadas / totalPlanilhas) * 100)
    : 0;

  const resumoPorConsultor = React.useMemo(() => {
    const mapa = new Map();

    const novaEntrada = (nome) => ({
      consultor: nome,
      empresas: new Set(),
      total: 0,
      recebido: 0,
      em_processamento: 0,
      finalizado: 0,
      comprovante_anexado: 0,
      pendentes: 0,
      lancadas: 0,
      taxa: 0,
    });

    clientes.forEach(cliente => {
      const nomeConsultor = cliente.consultor?.trim() || 'Sem consultor';
      if (!mapa.has(nomeConsultor)) mapa.set(nomeConsultor, novaEntrada(nomeConsultor));
      mapa.get(nomeConsultor).empresas.add(normalizarCnpj(cliente.cnpj));
    });

    planilhasFiltradas.forEach(planilha => {
      const nomeConsultor = planilha.consultor || 'Sem consultor';
      if (!mapa.has(nomeConsultor)) mapa.set(nomeConsultor, novaEntrada(nomeConsultor));

      const item = mapa.get(nomeConsultor);
      item.total += 1;
      if (item[planilha.statusNormalizado] !== undefined) {
        item[planilha.statusNormalizado] += 1;
      }
      if (['recebido', 'em_processamento'].includes(planilha.statusNormalizado)) {
        item.pendentes += 1;
      }
      if (['finalizado', 'comprovante_anexado'].includes(planilha.statusNormalizado)) {
        item.lancadas += 1;
      }
    });

    return [...mapa.values()]
      .map(item => ({
        ...item,
        empresas: item.empresas.size,
        taxa: item.total > 0 ? Math.round((item.lancadas / item.total) * 100) : 0,
      }))
      // Quando há filtros ativos, esconde consultores sem nenhuma planilha no recorte —
      // evita barras vazias no gráfico. Sem filtros, mantém todos para visão geral.
      .filter(item => {
        const filtrandoAlgo =
          filtroConsultor !== 'todos' ||
          filtroCompetencia !== 'todas' ||
          filtroStatus !== 'todos' ||
          somentePendencias ||
          busca.trim().length > 0;
        return filtrandoAlgo ? item.total > 0 : true;
      })
      .sort((a, b) => b.pendentes - a.pendentes || b.total - a.total);
  }, [
    clientes,
    planilhasFiltradas,
    filtroConsultor,
    filtroCompetencia,
    filtroStatus,
    somentePendencias,
    busca,
  ]);

  const maiorTotalConsultor = React.useMemo(() => (
    Math.max(...resumoPorConsultor.map(item => item.total), 1)
  ), [resumoPorConsultor]);

  const rankingPendencias = resumoPorConsultor
    .filter(item => item.pendentes > 0)
    .slice(0, 5);

  const pendenciasCriticas = planilhasFiltradas
    .filter(item => ['recebido', 'em_processamento'].includes(item.statusNormalizado))
    .filter(item => item.diasAguardando >= 3)
    .sort((a, b) => b.diasAguardando - a.diasAguardando);

  const ultimasPendencias = planilhasFiltradas
    .filter(item => ['recebido', 'em_processamento'].includes(item.statusNormalizado))
    .sort((a, b) => new Date(b.criado_em || 0) - new Date(a.criado_em || 0))
    .slice(0, 12);

  if (loading) {
    return <Empty msg="Carregando painel..." sub="Buscando coletas, consultores e empresas." icon="📊" />;
  }

  if (erroCarga) {
    return (
      <Card>
        <CardHead title="Erro ao carregar o painel" action={
          <Btn size="sm" onClick={carregar}>Tentar novamente</Btn>
        } />
        <div style={{ padding: 16, fontSize: 13, color: 'var(--red)' }}>
          {erroCarga}
        </div>
      </Card>
    );
  }

  const inputFiltroStyle = {
    padding: '9px 10px',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    fontSize: '12px',
    fontFamily: 'var(--font)',
    outline: 'none',
    background: '#fff',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div className="scm-fade-in">
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: '12px',
        marginBottom: '14px',
      }}>
        <StatCard value={totalPlanilhas} label="Planilhas no filtro" accent="black" />
        <StatCard value={pendentesLancamento} label="Pendentes de lançamento" accent="orange" />
        <StatCard value={emAndamento} label="Em processamento" accent="blue" />
        <StatCard value={lancadas} label="Já lançadas" accent="green" />
        <StatCard value={`${taxaLancamento}%`} label="Taxa de lançamento" accent="green" />
        <StatCard value={empresasSemConsultor} label="Empresas sem consultor" accent="orange" />
      </div>

      <Card>
  <CardHead
    title="Filtros da supervisora"
    action={
      <Btn size="sm" onClick={carregar}>
        Atualizar
      </Btn>
    }
  />

  <div style={{
    padding: '14px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '10px',
    alignItems: 'end',
  }}>
    <div>
  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
    Buscar
  </div>

  <input
    value={busca}
    onChange={(e) => setBusca(e.target.value)}
    placeholder="Cliente, CNPJ, consultor ou arquivo..."
    style={inputFiltroStyle}
  />
</div>

<div>
  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
    Consultor
  </div>

  <select
    value={filtroConsultor}
    onChange={(e) => setFiltroConsultor(e.target.value)}
    style={inputFiltroStyle}
  >
    <option value="todos">Todos os consultores</option>

    {consultoresFiltro.map(nome => (
      <option key={nome} value={nome}>
        {nome}
      </option>
    ))}
  </select>
</div>

<div>
  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
    Competência
  </div>

  <select
    value={filtroCompetencia}
    onChange={(e) => setFiltroCompetencia(e.target.value)}
    style={inputFiltroStyle}
  >
    <option value="todas">Todas</option>

    {competencias.map(comp => (
      <option key={comp} value={comp}>
        {comp}
      </option>
    ))}
  </select>
</div>

<div>
  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>
    Status
  </div>

  <select
    value={filtroStatus}
    onChange={(e) => setFiltroStatus(e.target.value)}
    style={inputFiltroStyle}
  >
    <option value="todos">Todos</option>
    <option value="recebido">Pendente lançamento</option>
    <option value="em_processamento">Em processamento</option>
    <option value="finalizado">Lançado</option>
    <option value="comprovante_anexado">Com comprovante</option>
  </select>
</div>

<label style={{
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '12px',
  color: 'var(--muted)',
  padding: '9px 10px',
  border: '1px solid var(--border)',
  borderRadius: '10px',
  background: '#FAFAF8',
  cursor: 'pointer',
}}>
  <input
    type="checkbox"
    checked={somentePendencias}
    onChange={(e) => setSomentePendencias(e.target.checked)}
  />

  Mostrar só pendências
</label>
  </div>
</Card>

<Card>
  <CardHead
    title="Gráfico por consultor — situação das planilhas"
    action={
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        <Pill label="Pendente" color="blue" />
        <Pill label="Em andamento" color="orange" />
        <Pill label="Lançado" color="green" />
      </div>
    }
  />

  <div style={{ padding: '18px' }}>
    <GraficoPizzaConsultores dados={resumoPorConsultor} />
  </div>
</Card>
      

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
        gap: '14px',
      }}>
        <Card>
          <CardHead title="Consultores com mais pendências" />

          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rankingPendencias.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                Nenhum consultor com pendência no filtro atual.
              </div>
            ) : (
              rankingPendencias.map((item, index) => (
                <div
                  key={item.consultor}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px',
                    border: '1px solid var(--border)',
                    borderRadius: '12px',
                    background: '#FAFAF8',
                  }}
                >
                  <div style={{
                    width: 28,
                    height: 28,
                    borderRadius: '10px',
                    background: index === 0 ? 'var(--orange)' : '#EBE9E3',
                    color: index === 0 ? '#fff' : 'var(--text)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 800,
                    fontFamily: 'var(--mono)',
                  }}>
                    {index + 1}
                  </div>

                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>
                      {item.consultor}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {item.pendentes} pendência(s) · {item.empresas} empresa(s)
                    </div>
                  </div>

                  <Pill label={`${item.taxa}% lançado`} color={item.taxa >= 80 ? 'green' : 'orange'} />
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <CardHead title="Alertas essenciais" />

          <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill label={`${empresasSemConsultor}`} color={empresasSemConsultor > 0 ? 'red' : 'green'} />
              <span style={{ fontSize: 12 }}>empresa(s) sem consultor responsável</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill label={`${pendenciasCriticas.length}`} color={pendenciasCriticas.length > 0 ? 'red' : 'green'} />
              <span style={{ fontSize: 12 }}>coleta(s) paradas há 3 dias ou mais</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill label={`${pendentesLancamento}`} color={pendentesLancamento > 0 ? 'orange' : 'green'} />
              <span style={{ fontSize: 12 }}>planilha(s) aguardando lançamento</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Pill label={`${taxaLancamento}%`} color={taxaLancamento >= 80 ? 'green' : 'orange'} />
              <span style={{ fontSize: 12 }}>taxa geral de lançamento no filtro</span>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title="Pendências de lançamento" />

        {ultimasPendencias.length === 0 ? (
          <Empty
            msg="Nenhuma pendência encontrada"
            sub="Todas as planilhas do filtro atual já foram lançadas ou estão com comprovante."
            icon="✅"
          />
        ) : (
          <Tbl headers={[
            'Cliente',
            'CNPJ',
            'Consultor',
            'Competência',
            'Arquivo',
            'Status',
            'Dias aguardando',
            'Recebido em',
            'Ações',
          ]}>
            {ultimasPendencias.map(item => (
              <TR key={item.id}>
                <TD>
                  <strong>{item.cliente_nome_final}</strong>
                </TD>

                <TD mono>{item.cnpj || '—'}</TD>

                <TD>
                  {item.consultor === 'Sem consultor'
                    ? <Pill label="Sem consultor" color="red" />
                    : item.consultor}
                </TD>

                <TD>{item.competenciaTexto}</TD>

                <TD>
                  <div style={{ fontWeight: 500 }}>
                    {item.nome_arquivo || item.nome_arquivo_original || '—'}
                  </div>

                  <div style={{
                    fontSize: 11,
                    color: 'var(--muted)',
                    marginTop: 2,
                  }}>
                    Final: {item.nome_arquivo_final || '—'}
                  </div>
                </TD>

                <TD>
                  <Pill label={item.statusInfo.label} color={item.statusInfo.color} />
                </TD>

                <TD>
                  <Pill
                    label={`${item.diasAguardando} dia(s)`}
                    color={item.diasAguardando >= 3 ? 'red' : 'gray'}
                  />
                </TD>

                <TD mono>{formatarDataSupervisor(item.criado_em)}</TD>

                <TD>
                  <ActBtn
                    variant="edit"
                    title="Marcar em processamento"
                    disabled={saving === item.id || item.statusNormalizado === 'em_processamento'}
                    onClick={() => alterarStatus(item, 'em_processamento')}
                  >
                    ▶
                  </ActBtn>

                  <ActBtn
                    variant="edit"
                    title="Marcar como lançado"
                    disabled={saving === item.id || item.statusNormalizado === 'finalizado'}
                    onClick={() => alterarStatus(item, 'finalizado')}
                  >
                    ✓
                  </ActBtn>
                </TD>
              </TR>
            ))}
          </Tbl>
        )}
      </Card>
    </div>
  );
}

/* ==============================
   SUPERVISOR — AGENDA DO DIA
   ============================== */
function ViewSupervisorAgenda() {
  const { user } = useAuth();
  const chaveTasks = `supervisor_tasks_${user?.id || 'default'}`;
  const chaveNotas = `supervisor_notas_${user?.id || 'default'}`;

  const [tasks, setTasks] = useState(() => {
    try {
      const raw = localStorage.getItem(chaveTasks);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const [notas, setNotas] = useState(() => {
    try { return localStorage.getItem(chaveNotas) || ''; } catch { return ''; }
  });
  const [novoItem, setNovoItem] = useState('');
  const [novaPrioridade, setNovaPrioridade] = useState('media');

  useEffect(() => {
    try { localStorage.setItem(chaveTasks, JSON.stringify(tasks)); } catch {}
  }, [tasks, chaveTasks]);

  useEffect(() => {
    try { localStorage.setItem(chaveNotas, notas); } catch {}
  }, [notas, chaveNotas]);

  const adicionar = () => {
    const text = novoItem.trim();
    if (!text) return;
    setTasks(t => [
      ...t,
      { id: Date.now(), text, done: false, prioridade: novaPrioridade, criadoEm: new Date().toISOString() },
    ]);
    setNovoItem('');
    setNovaPrioridade('media');
  };

  const toggle = (id) => setTasks(t => t.map(i => i.id === id ? { ...i, done: !i.done } : i));
  const remover = (id) => setTasks(t => t.filter(i => i.id !== id));
  const limparConcluidas = () => {
    if (window.confirm('Remover todas as tarefas concluídas?')) {
      setTasks(t => t.filter(i => !i.done));
    }
  };
  const limparTudo = () => {
    if (window.confirm('Remover todas as tarefas do dia?')) setTasks([]);
  };

  const concluidas = tasks.filter(t => t.done).length;
  const total = tasks.length;
  const pendentes = total - concluidas;
  const progresso = total > 0 ? Math.round((concluidas / total) * 100) : 0;

  const corPrioridade = {
    alta:  { bg: '#FDECEC', c: 'var(--red)',    label: 'Alta'  },
    media: { bg: '#FFF8E1', c: 'var(--amber)',  label: 'Média' },
    baixa: { bg: '#EAF7EE', c: 'var(--green)',  label: 'Baixa' },
  };

  const tasksOrdenadas = [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ordem = { alta: 0, media: 1, baixa: 2 };
    return (ordem[a.prioridade] ?? 1) - (ordem[b.prioridade] ?? 1);
  });

  const dataHoje = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });

  const grid = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '14px' };
  const inputStyle = {
    flex: 1, padding: '9px 11px', border: '1px solid var(--border)',
    borderRadius: 'var(--r-sm)', fontSize: 13, fontFamily: 'inherit', background: 'var(--card)',
  };

  return <div>
    <Banner role="admin" icon="🗒️" title={`Agenda — ${dataHoje}`} sub={`${pendentes} pendente(s) · ${concluidas} concluída(s) · ${progresso}% do dia`} />

    <div style={grid}>
      <StatCard value={pendentes}  label="Tarefas pendentes" accent="orange" />
      <StatCard value={concluidas} label="Concluídas"        accent="green"  />
      <StatCard value={total}      label="Total no dia"      accent="black"  />
      <StatCard value={`${progresso}%`} label="Progresso"     accent="blue"   />
    </div>

    <Card>
      <CardHead
        title="Check-list do dia"
        action={total > 0 && <div style={{ display: 'flex', gap: 6 }}>
          {concluidas > 0 && <Btn variant="outline" size="sm" onClick={limparConcluidas}>Limpar concluídas</Btn>}
          <Btn variant="danger" size="sm" onClick={limparTudo}>Limpar tudo</Btn>
        </div>}
      />
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            value={novoItem}
            onChange={e => setNovoItem(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') adicionar(); }}
            placeholder="Nova tarefa..."
            style={{ ...inputStyle, minWidth: 200 }}
          />
          <select
            value={novaPrioridade}
            onChange={e => setNovaPrioridade(e.target.value)}
            style={{ ...inputStyle, flex: '0 0 auto', minWidth: 110 }}
          >
            <option value="alta">Alta</option>
            <option value="media">Média</option>
            <option value="baixa">Baixa</option>
          </select>
          <Btn variant="dark" size="sm" onClick={adicionar}>+ Adicionar</Btn>
        </div>

        {tasks.length === 0
          ? <Empty msg="Nenhuma tarefa para hoje" sub="Adicione uma tarefa acima para começar o dia." />
          : <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tasksOrdenadas.map(item => {
                const p = corPrioridade[item.prioridade] || corPrioridade.media;
                return <div key={item.id} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 11px', border: '1px solid var(--border)',
                  borderRadius: 'var(--r-sm)',
                  background: item.done ? 'var(--green-pale)' : 'var(--card)',
                  opacity: item.done ? 0.7 : 1,
                }}>
                  <input
                    type="checkbox"
                    checked={item.done}
                    onChange={() => toggle(item.id)}
                    style={{ cursor: 'pointer', width: 16, height: 16, flexShrink: 0 }}
                  />
                  <span style={{
                    flex: 1, fontSize: 13,
                    textDecoration: item.done ? 'line-through' : 'none',
                    color: item.done ? 'var(--muted)' : 'var(--text)',
                    wordBreak: 'break-word',
                  }}>{item.text}</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 'var(--r-pill)',
                    background: p.bg, color: p.c, fontSize: 10, fontWeight: 600,
                    textTransform: 'uppercase', letterSpacing: '.05em', flexShrink: 0,
                  }}>{p.label}</span>
                  <ActBtn variant="del" title="Remover" onClick={() => remover(item.id)}>✕</ActBtn>
                </div>;
              })}
            </div>}
      </div>
    </Card>

    <Card>
      <CardHead
        title="Anotações"
        action={notas && <Btn variant="outline" size="sm" onClick={() => {
          if (window.confirm('Limpar todas as anotações?')) setNotas('');
        }}>Limpar</Btn>}
      />
      <div style={{ padding: '12px 16px' }}>
        <textarea
          value={notas}
          onChange={e => setNotas(e.target.value)}
          placeholder="Escreva suas anotações do dia, lembretes, observações dos consultores, pontos de atenção..."
          rows={10}
          style={{
            width: '100%', padding: '11px 13px',
            border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
            fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
            background: 'var(--card)', color: 'var(--text)', lineHeight: 1.5,
          }}
        />
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--faint)', display: 'flex', justifyContent: 'space-between' }}>
          <span>Salvo automaticamente no seu navegador</span>
          <span>{notas.length} caractere(s)</span>
        </div>
      </div>
    </Card>
  </div>;
}

/* ==============================
   SUPERVISOR — COLETAS POR CONSULTOR
   ============================== */
function ViewSupervisorColetas() {
  const [clientes, setClientes] = useState([]);
  const [planilhas, setPlanilhas] = useState([]);
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [filtroConsultor, setFiltroConsultor] = useState('todos');
  const [busca, setBusca] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [cli, pla] = await Promise.all([
      supabase.from('clientes').select('id, nome, cnpj, consultor'),
      supabase.from('planilhas_coleta').select('*').order('criado_em', { ascending: false }),
    ]);
    setClientes(cli.data || []);
    setPlanilhas(pla.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const alterarStatus = async (item, novoStatus) => {
    setSaving(item.id);
    const { error } = await supabase
      .from('planilhas_coleta')
      .update({ status: novoStatus, atualizado_em: new Date().toISOString() })
      .eq('id', item.id);
    setSaving(null);
    if (error) { alert(error.message); return; }
    setPlanilhas(prev => prev.map(p => p.id === item.id ? { ...p, status: novoStatus } : p));
  };

  const idxClientes = new Map();
  clientes.forEach(c => idxClientes.set(normalizarCnpj(c.cnpj), c));

  const consultoresDistintos = (() => {
    const s = new Set();
    clientes.forEach(c => { const v = (c.consultor || '').trim(); if (v) s.add(v); });
    return [...s].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  })();

  const buscaLow = busca.trim().toLowerCase();
  const planilhasFiltradas = planilhas.filter(p => {
    if (filtroStatus !== 'todos' && (p.status || '') !== filtroStatus) return false;
    const cli = idxClientes.get(normalizarCnpj(p.cnpj));
    const consultor = (cli?.consultor || '').trim() || 'Sem consultor';
    if (filtroConsultor !== 'todos' && consultor !== filtroConsultor) return false;
    if (buscaLow) {
      const blob = `${p.cliente_nome || ''} ${p.cnpj || ''} ${p.nome_arquivo || ''} ${cli?.nome || ''}`.toLowerCase();
      if (!blob.includes(buscaLow)) return false;
    }
    return true;
  });

  const grupos = (() => {
    const idx = new Map();
    planilhasFiltradas.forEach(p => {
      const cli = idxClientes.get(normalizarCnpj(p.cnpj));
      const consultor = (cli?.consultor || '').trim() || 'Sem consultor';
      if (!idx.has(consultor)) idx.set(consultor, []);
      idx.get(consultor).push(p);
    });
    return [...idx.entries()].sort((a, b) => {
      if (a[0] === 'Sem consultor') return -1;
      if (b[0] === 'Sem consultor') return 1;
      return a[0].localeCompare(b[0], 'pt-BR');
    });
  })();

  if (loading) return <Empty msg="Carregando..." sub="Buscando coletas." />;

  const selectStyle = { padding: '7px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 12, background: 'var(--card)' };

  return <div>
    <Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input type="search" placeholder="Buscar por cliente, CNPJ ou arquivo..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ ...selectStyle, minWidth: 240, flex: 1 }} />
        <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)} style={selectStyle}>
          <option value="todos">Todos os status</option>
          <option value="recebido">Recebido</option>
          <option value="em_processamento">Em processamento</option>
          <option value="finalizado">Finalizado</option>
          <option value="comprovante_anexado">Com comprovante</option>
        </select>
        <select value={filtroConsultor} onChange={e => setFiltroConsultor(e.target.value)} style={selectStyle}>
          <option value="todos">Todos os consultores</option>
          <option value="Sem consultor">Sem consultor</option>
          {consultoresDistintos.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
    </Card>

    {grupos.length === 0
      ? <Empty msg="Nenhuma coleta encontrada" sub="Ajuste os filtros ou aguarde novas coletas." />
      : grupos.map(([consultor, lista]) => {
          const stats = { recebido: 0, em_processamento: 0, finalizado: 0, comprovante_anexado: 0 };
          const empresasSet = new Set();
          lista.forEach(p => {
            empresasSet.add(normalizarCnpj(p.cnpj));
            if (stats[p.status] !== undefined) stats[p.status] += 1;
          });
          return <Card key={consultor}>
            <CardHead
              title={`${consultor}  ·  ${empresasSet.size} empresa(s)  ·  ${lista.length} coleta(s)`}
              action={<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Pill label={`Recebidas ${stats.recebido}`} color="blue" />
                <Pill label={`Em proc. ${stats.em_processamento}`} color="orange" />
                <Pill label={`Finalizadas ${stats.finalizado}`} color="gray" />
                <Pill label={`Comprovante ${stats.comprovante_anexado}`} color="green" />
              </div>}
            />
            <Tbl headers={['Cliente', 'CNPJ', 'Competência', 'Arquivo', 'Total orig.', 'Total final', 'Duplic.', 'Status', 'Enviado em', 'Ações']}>
              {lista.map(p => <TR key={p.id}>
                <TD>{p.cliente_nome || idxClientes.get(normalizarCnpj(p.cnpj))?.nome || '—'}</TD>
                <TD mono>{p.cnpj}</TD>
                <TD>{competenciaSupervisor(p)}</TD>
                <TD>{p.nome_arquivo || '—'}</TD>
                <TD>{p.total_original ?? '—'}</TD>
                <TD>{p.total_final ?? '—'}</TD>
                <TD>{p.duplicidades ?? '—'}</TD>
                <TD>{pillStatus(p.status)}</TD>
                <TD>{formatarDataBr(p.criado_em)}</TD>
                <TD>
                  <ActBtn variant="dl"   title="Baixar CSV"           onClick={() => baixarPlanilhaSupervisor(p)}>⬇</ActBtn>
                  <ActBtn variant="edit" title="Marcar em processamento" disabled={saving === p.id || p.status === 'em_processamento'} onClick={() => alterarStatus(p, 'em_processamento')}>▶</ActBtn>
                  <ActBtn variant="edit" title="Marcar finalizado"      disabled={saving === p.id || p.status === 'finalizado'}       onClick={() => alterarStatus(p, 'finalizado')}>✓</ActBtn>
                </TD>
              </TR>)}
            </Tbl>
          </Card>;
        })}
  </div>;
}

/* ==============================
   SUPERVISOR — EMPRESAS E CONSULTORES
   ============================== */
function ViewSupervisorEmpresas() {
  const [clientes, setClientes] = useState([]);
  const [consultores, setConsultores] = useState([]);
  const [planilhas, setPlanilhas] = useState([]);
  const [pendentes, setPendentes] = useState({});
  const [filtroConsultor, setFiltroConsultor] = useState('todos');
  const [apenasSemConsultor, setApenasSemConsultor] = useState(false);
  const [busca, setBusca] = useState('');
  const [saving, setSaving] = useState(null);
  const [flash, setFlash] = useState('');
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [cli, cons, pla] = await Promise.all([
      supabase.from('clientes').select('*').order('nome', { ascending: true }),
      supabase.from('usuarios').select('id, nome, email').eq('role', 'consult').eq('ativo', true).order('nome'),
      supabase.from('planilhas_coleta').select('cnpj, criado_em'),
    ]);
    setClientes(cli.data || []);
    setConsultores(cons.data || []);
    setPlanilhas(pla.data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelado = false;
    let tid = null;
    carregar();

    const agendar = () => {
      if (cancelado) return;
      if (tid) clearTimeout(tid);
      tid = setTimeout(() => { if (!cancelado) carregar(); }, 600);
    };

    const canal = supabase
      .channel('supervisor-empresas-tempo-real')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, agendar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planilhas_coleta' }, agendar)
      .subscribe();

    return () => {
      cancelado = true;
      if (tid) clearTimeout(tid);
      supabase.removeChannel(canal);
    };
  }, [carregar]);

  const contagemPorCnpj = (() => {
    const m = {};
    planilhas.forEach(p => {
      const k = normalizarCnpj(p.cnpj);
      m[k] = (m[k] || 0) + 1;
    });
    return m;
  })();

  const ultimaPorCnpj = (() => {
    const m = {};
    planilhas.forEach(p => {
      const k = normalizarCnpj(p.cnpj);
      if (!m[k] || (p.criado_em && p.criado_em > m[k])) m[k] = p.criado_em;
    });
    return m;
  })();

  const buscaLow = busca.trim().toLowerCase();
  const empresasFiltradas = clientes.filter(c => {
    const semConsultor = !c.consultor || !c.consultor.trim();
    if (apenasSemConsultor && !semConsultor) return false;
    if (filtroConsultor !== 'todos') {
      if (filtroConsultor === 'Sem consultor') {
        if (!semConsultor) return false;
      } else if ((c.consultor || '').trim() !== filtroConsultor) {
        return false;
      }
    }
    if (buscaLow) {
      const blob = `${c.nome || ''} ${c.cnpj || ''} ${c.email || ''}`.toLowerCase();
      if (!blob.includes(buscaLow)) return false;
    }
    return true;
  });

  const salvar = async (c) => {
    setSaving(c.id);
    const novo = (pendentes[c.id] || '').trim();
    const { data, error } = await supabase
      .from('clientes')
      .update({ consultor: novo || null })
      .eq('id', c.id)
      .select('id, consultor')
      .maybeSingle();
    setSaving(null);
    if (error) {
      alert(`Não foi possível salvar o vínculo: ${error.message}`);
      return;
    }
    if (!data) {
      alert('Você não tem permissão para alterar o vínculo deste cliente.');
      return;
    }
    setClientes(prev => prev.map(x => x.id === c.id ? { ...x, consultor: novo || null } : x));
    setPendentes(prev => { const n = { ...prev }; delete n[c.id]; return n; });
    setFlash(`Consultor de "${c.nome}" atualizado.`);
    setTimeout(() => setFlash(''), 2500);
  };

  if (loading) return <Empty msg="Carregando..." sub="Buscando empresas e consultores." />;

  const selectStyle = { padding: '7px 10px', borderRadius: 'var(--r-sm)', border: '1px solid var(--border)', fontSize: 12, background: 'var(--card)' };

  return <div>
    <Card>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <input type="search" placeholder="Buscar por empresa, CNPJ ou e-mail..." value={busca} onChange={e => setBusca(e.target.value)}
          style={{ ...selectStyle, minWidth: 240, flex: 1 }} />
        <select value={filtroConsultor} onChange={e => setFiltroConsultor(e.target.value)} style={selectStyle}>
          <option value="todos">Todos os consultores</option>
          <option value="Sem consultor">Sem consultor</option>
          {consultores.map(co => <option key={co.id} value={co.nome}>{co.nome}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text)' }}>
          <input type="checkbox" checked={apenasSemConsultor} onChange={e => setApenasSemConsultor(e.target.checked)} />
          Somente sem consultor
        </label>
      </div>
    </Card>

    <Card>
      <CardHead title={`Empresas (${empresasFiltradas.length})`} />
      {empresasFiltradas.length === 0
        ? <Empty msg="Nenhuma empresa encontrada" sub="Ajuste os filtros." />
        : <Tbl headers={['Empresa', 'CNPJ', 'E-mail', 'Consultor atual', 'Novo consultor', 'Status', 'Coletas', 'Última coleta', 'Ações']}>
            {empresasFiltradas.map(c => {
              const semConsultor = !c.consultor || !c.consultor.trim();
              const valorSelect = pendentes[c.id] !== undefined ? pendentes[c.id] : (c.consultor || '');
              const desabilitarSalvar = saving === c.id
                || pendentes[c.id] === undefined
                || (pendentes[c.id] || '').trim() === (c.consultor || '').trim();
              const k = normalizarCnpj(c.cnpj);
              return <TR key={c.id}>
                <TD style={semConsultor ? { background: '#FFF4EC' } : undefined}>{c.nome}</TD>
                <TD mono>{c.cnpj}</TD>
                <TD>{c.email || '—'}</TD>
                <TD>{semConsultor ? <Pill label="Sem consultor" color="red" /> : c.consultor}</TD>
                <TD>
                  <select value={valorSelect} onChange={e => setPendentes(p => ({ ...p, [c.id]: e.target.value }))} style={selectStyle}>
                    <option value="">Sem consultor</option>
                    {consultores.map(co => <option key={co.id} value={co.nome}>{co.nome} — {co.email}</option>)}
                  </select>
                </TD>
                <TD>{c.status || 'ativo'}</TD>
                <TD>{contagemPorCnpj[k] || 0}</TD>
                <TD>{ultimaPorCnpj[k] ? formatarDataBr(ultimaPorCnpj[k]) : '—'}</TD>
                <TD>
                  <ActBtn variant="edit" title="Salvar alteração" disabled={desabilitarSalvar} onClick={() => salvar(c)}>💾</ActBtn>
                </TD>
              </TR>;
            })}
          </Tbl>}
    </Card>

    {flash && <div style={{
      position: 'fixed', right: 18, bottom: 18, padding: '10px 14px',
      background: '#1E7E34', color: '#fff', borderRadius: 'var(--r-md)',
      boxShadow: '0 6px 18px rgba(0,0,0,.18)', fontSize: 13, zIndex: 60,
    }}>{flash}</div>}
  </div>;
}

/* ==============================
   TOPBAR
   ============================== */
const TAG_STYLE = {
  admin: { bg: '#E8E8EC', c: '#18171A', label: 'ADMINISTRADOR' },
  consult: { bg: '#EBEBED', c: '#4A4A4E', label: 'CONSULTOR' },
  client: { bg: '#FFF4EC', c: '#B04D00', label: 'CLIENTE' },
  supervisor: { bg: '#E6F0F9', c: '#1B3A57', label: 'SUPERVISOR' },
};

const TOPBAR_CFG = {
  vistoria: {
    title: 'Vistoria Mensal',
    sub: () => 'Vistorias regulatórias — consulta CNPJ, Simples Nacional e coletas',
    btns: { admin: [], consult: [], client: [] }
  },
  integracoes: {
    title: 'Integração de Coletas',
    sub: () => 'Puxe arquivos diretamente do sistema da empresa',
    btns: { admin: [], consult: [], client: [] }
  },
  dashboard: {
    title: 'Painel',
    sub: (r) => r === 'client' ? 'Seus dados regulatórios' : 'Visão geral do sistema',
    btns: {
      admin: [{ l: 'Ver Coletas DICI', v: 'dici', var: 'outline' }, { l: '✎ Editar site', v: 'editor', var: 'dark' }],

      client: [],
    }
  },
  dici: { title: 'Coleta DICI', sub: () => 'DICI SCM — Coletas mensais', btns: { admin: [], consult: [], client: [] } },
  users: { title: 'Usuários', sub: () => 'Gestão de acessos', btns: { admin: [], consult: [], client: [] } },
  editor: { title: 'Editor do Site', sub: () => 'Personalização da plataforma', btns: { admin: [], consult: [], client: [] } },
  perms: { title: 'Permissões', sub: () => 'Controle de permissões', btns: { admin: [], consult: [], client: [] } },

  docs: {
    title: 'Comprovantes',
    sub: () => 'Comprovantes mensais',
    btns: { admin: [], consult: [], client: [] }
  },

  documentos: {
    title: 'Documentos Gerais',
    sub: () => 'Documentações gerais dos clientes',
    btns: { admin: [], consult: [], client: [] }
  },

  planilhas: {
    title: 'Planilhas',
    sub: () => 'Planilhas encaminhadas por competência',
    btns: { admin: [], consult: [], client: [] }
  },

  feedback: {
    title: 'Feedback dos clientes',
    sub: () => 'Sugestões, dúvidas, problemas e elogios recebidos',
    btns: { admin: [], consult: [], client: [] }
  },

fust_funttel: {
  title: 'Guias FUST/FUNTTEL',
  sub: () => 'Cálculo mensal, envio ao consultor e guias para download',
  btns: { admin: [], consult: [], client: [] }
},

  anuidades_anatel: {
    title: 'Anuidade ANATEL',
    sub: () => 'Boletos anuais da ANATEL',
    btns: { admin: [], consult: [], client: [] }
  },

  anuidades_crea_cft: {
    title: 'Anuidade CREA/CFT',
    sub: () => 'Boletos anuais do CREA / CFT',
    btns: { admin: [], consult: [], client: [] }
  },

  anuidades_ancine: {
    title: 'Anuidade ANCINE',
    sub: () => 'Boletos anuais da ANCINE',
    btns: { admin: [], consult: [], client: [] }
  },

  supervisor_dashboard: {
    title: 'Painel do Supervisor',
    sub: () => 'Acompanhamento geral das coletas, consultores e empresas',
    btns: { admin: [], consult: [], client: [], supervisor: [] },
  },
  supervisor_agenda: {
    title: 'Agenda do Dia',
    sub: () => 'Check-list de tarefas e bloco de anotações',
    btns: { admin: [], consult: [], client: [], supervisor: [] },
  },
  supervisor_coletas: {
    title: 'Coletas por Consultor',
    sub: () => 'Visualize o andamento das coletas separadas por responsável',
    btns: { admin: [], consult: [], client: [], supervisor: [] },
  },
  supervisor_empresas: {
    title: 'Empresas e Consultores',
    sub: () => 'Gerencie o consultor responsável por cada empresa',
    btns: { admin: [], consult: [], client: [], supervisor: [] },
  },
};
function moedaParaNumero(valor) {
  const texto = String(valor ?? '')
    .replace(/[R$\s]/g, '')
    .trim();

  if (!texto) return 0;

  const normalizado = texto.includes(',')
    ? texto.replace(/\./g, '').replace(',', '.')
    : texto;

  const numero = Number(normalizado);

  return Number.isFinite(numero) ? numero : 0;
}

function numeroParaMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(valor) || 0);
}

function arredondarMoeda(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

function calcularFustFunttel({ receitaBruta, icms, pis, cofins }) {
  const receita = moedaParaNumero(receitaBruta);
  const valorIcms = moedaParaNumero(icms);
  const valorPis = moedaParaNumero(pis);
  const valorCofins = moedaParaNumero(cofins);

  const deducoes = arredondarMoeda(valorIcms + valorPis + valorCofins);
  const baseCalculo = arredondarMoeda(Math.max(receita - deducoes, 0));

  const fust = arredondarMoeda(baseCalculo * 0.01);
  const funttel = arredondarMoeda(baseCalculo * 0.005);
  const total = arredondarMoeda(fust + funttel);

  return {
    receita,
    valorIcms,
    valorPis,
    valorCofins,
    deducoes,
    baseCalculo,
    fust,
    funttel,
    total,
  };
}


function ViewFustFunttel() {
  const { user, isClient, isConsult, isAdmin } = useAuth();
  const isMobile = useMobile();

  const fileRef = React.useRef(null);

  const [competencia, setCompetencia] = useState(() => {
    const hoje = new Date();
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  });

  const [receitaBruta, setReceitaBruta] = useState('');
  const [icms, setIcms] = useState('');
  const [pis, setPis] = useState('');
  const [cofins, setCofins] = useState('');
  const [observacao, setObservacao] = useState('');

  const [itens, setItens] = useState([]);
  const [boletos, setBoletos] = useState([]);
  const [itemSelecionado, setItemSelecionado] = useState(null);
const [declaracaoUpload, setDeclaracaoUpload] = useState(null);
const [tipoBoleto, setTipoBoleto] = useState('fust');
const [modalAnexar, setModalAnexar] = useState(null);

  // Para o cliente: lista completa de boletos do próprio CNPJ (não exige selecionar declaração).
  const [meusBoletos, setMeusBoletos] = useState([]);
  const [carregandoMeusBoletos, setCarregandoMeusBoletos] = useState(false);

  // Para o consultor/admin: envio direto de guia (sem precisar de declaração do cliente).
  const [clientes, setClientes] = useState([]);
  const [clienteDireto, setClienteDireto] = useState('');
  const [competenciaDireta, setCompetenciaDireta] = useState(() => {
    const hoje = new Date();
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  });
  const [tipoBoletoDireto, setTipoBoletoDireto] = useState('fust');
  const [anexandoDireto, setAnexandoDireto] = useState(false);
  const fileRefDireto = React.useRef(null);

  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const calculo = calcularFustFunttel({
    receitaBruta,
    icms,
    pis,
    cofins,
  });

  const normalizarNomeConsultor = (valor = '') => {
  return removerAcentos(String(valor || ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
};

const carregarCnpjsPermitidosConsultor = useCallback(async () => {
  if (!isConsult) return null;

  const nomeConsultorLogado = normalizarNomeConsultor(user?.nome || user?.name);

  const { data, error } = await supabase
    .from('clientes')
    .select('id, nome, cnpj, consultor')
    .not('consultor', 'is', null);

  if (error) {
    throw error;
  }

  return new Set(
    (data || [])
      .filter(cliente => {
        return normalizarNomeConsultor(cliente.consultor) === nomeConsultorLogado;
      })
      .map(cliente => normalizarCnpj(cliente.cnpj))
      .filter(Boolean)
  );
}, [isConsult, user?.nome, user?.name]);

const carregar = useCallback(async () => {
  try {
    setCarregando(true);
    setErro('');

    const cnpjsPermitidosConsultor = await carregarCnpjsPermitidosConsultor();

    if (isConsult && cnpjsPermitidosConsultor?.size === 0) {
      setItens([]);
      return;
    }

    let query = supabase
      .from('fust_funttel')
      .select('*')
      .order('criado_em', { ascending: false });

    if (isClient) {
      query = query.eq('usuario_id', user?.id);
    }

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    let lista = data || [];

    if (isConsult) {
      lista = lista.filter(item => {
        return cnpjsPermitidosConsultor.has(normalizarCnpj(item.cnpj));
      });
    }

    setItens(lista);
  } catch (error) {
    console.error('Erro ao carregar FUST/FUNTTEL:', error);
    setErro(error.message || 'Erro ao carregar FUST/FUNTTEL.');
  } finally {
    setCarregando(false);
  }
}, [
  isClient,
  isConsult,
  user?.id,
  carregarCnpjsPermitidosConsultor,
]);

const carregarBoletos = useCallback(async () => {
  try {
    const cnpjsPermitidosConsultor = await carregarCnpjsPermitidosConsultor();

    if (isConsult && cnpjsPermitidosConsultor?.size === 0) {
      setBoletos([]);
      return;
    }

    let query = supabase
      .from('fust_funttel_boletos')
      .select('*')
      .order('criado_em', { ascending: false });

    if (itemSelecionado?.id) {
      query = query.eq('declaracao_id', itemSelecionado.id);
    } else if (isClient) {
      query = query.eq('cnpj', normalizarCnpj(user?.cnpj));
    } else if (!isConsult) {
      query = query.limit(50);
    }

    const { data, error } = await query;

    if (error) throw error;

    let lista = data || [];

    if (isConsult) {
      lista = lista.filter(boleto => {
        return cnpjsPermitidosConsultor.has(normalizarCnpj(boleto.cnpj));
      });
    }

    setBoletos(lista);
  } catch (error) {
    console.error('Erro ao carregar boletos:', error);
    setBoletos([]);
  }
}, [
  itemSelecionado?.id,
  isClient,
  isConsult,
  user?.cnpj,
  carregarCnpjsPermitidosConsultor,
]);

  useEffect(() => {
    carregar();

    const ch = supabase
      .channel('fust-funttel-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fust_funttel' }, () => carregar())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fust_funttel_boletos' }, () => carregarBoletos())
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, [carregar, carregarBoletos]);

  useEffect(() => {
    carregarBoletos();
  }, [carregarBoletos]);

  // Cliente: carrega TODOS os boletos do próprio CNPJ — não exige selecionar declaração.
  const carregarMeusBoletos = useCallback(async () => {
    if (!isClient) return;

    const cnpjLimpo = normalizarCnpj(user?.cnpj);
    if (!cnpjLimpo) return;

    try {
      setCarregandoMeusBoletos(true);
      const { data, error } = await supabase
        .from('fust_funttel_boletos')
        .select('*')
        .eq('cnpj', cnpjLimpo)
        .order('competencia', { ascending: false })
        .order('criado_em', { ascending: false });

      if (error) throw error;
      setMeusBoletos(data || []);
    } catch (error) {
      console.error('Erro ao carregar meus boletos FUST/FUNTTEL:', error);
      setMeusBoletos([]);
    } finally {
      setCarregandoMeusBoletos(false);
    }
  }, [isClient, user?.cnpj]);

  // Carrega ao montar + reage a inserts/updates de boletos via realtime.
  useEffect(() => {
    if (!isClient) return;

    carregarMeusBoletos();

    const ch = supabase
      .channel('meus-boletos-fust-funttel')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'fust_funttel_boletos' },
        () => carregarMeusBoletos()
      )
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [isClient, carregarMeusBoletos]);

  // Ao abrir a aba (cliente), marca todos os boletos como lidos — limpa a notificação no menu.
  useEffect(() => {
    if (!isClient || !user?.id) return;
    localStorage.setItem(`guias_fust_funttel_ultima_leitura_${user.id}`, new Date().toISOString());
    window.dispatchEvent(new CustomEvent('scm-fust-boletos-lidos'));
  }, [isClient, user?.id]);

  const enviarDeclaracao = async () => {
    try {
      setSalvando(true);
      setErro('');

      if (!competencia) {
        throw new Error('Informe a competência.');
      }

      if (calculo.receita <= 0) {
        throw new Error('Informe a receita bruta.');
      }

      const [ano, mes] = competencia.split('-');

      const { error } = await supabase
        .from('fust_funttel')
        .insert({
          usuario_id: user?.id,
          cnpj: normalizarCnpj(user?.cnpj),
          cliente_nome: user?.name || user?.nome || user?.email,

          competencia,
          competencia_ano: Number(ano),
          competencia_mes: Number(mes),

          receita_bruta: calculo.receita,
          icms: calculo.valorIcms,
          pis: calculo.valorPis,
          cofins: calculo.valorCofins,

          observacao: observacao.trim() || null,
          status: 'enviado',
        });

      if (error) throw error;

      alert('FUST/FUNTTEL enviado para o consultor com sucesso!');

      setReceitaBruta('');
      setIcms('');
      setPis('');
      setCofins('');
      setObservacao('');

      await carregar();
    } catch (error) {
      console.error('Erro ao enviar FUST/FUNTTEL:', error);
      setErro(error.message || 'Erro ao enviar FUST/FUNTTEL.');
    } finally {
      setSalvando(false);
    }
  };

  const alterarStatus = async (item, novoStatus) => {
    try {
      const { error } = await supabase
        .from('fust_funttel')
        .update({
          status: novoStatus,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', item.id);

      if (error) throw error;

      await carregar();
    } catch (error) {
      alert(error.message || 'Erro ao alterar status.');
    }
  };

  const anexarBoleto = async (event) => {
    const file = event.target.files?.[0];

    if (!file) return;

    try {
      if (!itemSelecionado?.id) {
        alert('Selecione uma declaração antes de anexar o boleto.');
        return;
      }

      const nomeSeguro = file.name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9.\-_]+/g, '_');

      const caminho = `clientes/${itemSelecionado.cnpj}/fust-funttel/${itemSelecionado.competencia}/${tipoBoleto}/${Date.now()}_${nomeSeguro}`;

      const { error: uploadError } = await supabase.storage
        .from('boletos-fust-funttel')
        .upload(caminho, file, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from('fust_funttel_boletos')
        .insert({
          declaracao_id: itemSelecionado.id,
          cnpj: itemSelecionado.cnpj,
          competencia: itemSelecionado.competencia,
          tipo_boleto: tipoBoleto,
          nome_original: file.name,
          arquivo_path: caminho,
          tamanho_bytes: file.size,
          tipo_arquivo: file.type || null,
          enviado_por: user?.id || null,
          enviado_por_nome: user?.name || user?.nome || user?.email || 'Usuário',
        });

      if (insertError) throw insertError;

      await supabase
        .from('fust_funttel')
        .update({
          status: 'boleto_anexado',
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', itemSelecionado.id);

      alert('Boleto anexado com sucesso!');

      await carregar();
      await carregarBoletos();
    } catch (error) {
      console.error('Erro ao anexar boleto:', error);
      alert(error.message || 'Não foi possível anexar o boleto.');
    } finally {
      event.target.value = '';
    }
  };

  const baixarBoleto = async (item) => {
    try {
      const { data, error } = await supabase.storage
        .from('boletos-fust-funttel')
        .download(item.arquivo_path);

      if (error) throw error;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(data);
      a.download = item.nome_original || 'boleto';
      a.click();

      URL.revokeObjectURL(a.href);
    } catch (error) {
      alert(error.message || 'Erro ao baixar boleto.');
    }
  };

  const excluirBoleto = async (item) => {
    if (!confirm('Deseja excluir este boleto?')) return;

    try {
      if (item.arquivo_path) {
        const { error: storageError } = await supabase.storage
          .from('boletos-fust-funttel')
          .remove([item.arquivo_path]);

        if (storageError) throw storageError;
      }

      const { error } = await supabase
        .from('fust_funttel_boletos')
        .delete()
        .eq('id', item.id);

      if (error) throw error;

      await carregarBoletos();
    } catch (error) {
      alert(error.message || 'Erro ao excluir boleto.');
    }
  };

const carregarClientes = useCallback(async () => {
  if (!isConsult && !isAdmin) return;

  try {
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;

    const nomeConsultorLogado = normalizarNomeConsultor(user?.nome || user?.name);

    let lista = (data || []).map(c => ({
      ...c,
      cnpj: normalizarCnpj(c.cnpj),
    }));

    if (isConsult) {
      lista = lista.filter(cliente => {
        return normalizarNomeConsultor(cliente.consultor) === nomeConsultorLogado;
      });
    }

    setClientes(lista);

    const clienteDiretoAindaExiste = lista.some(cliente => {
      return normalizarCnpj(cliente.cnpj) === normalizarCnpj(clienteDireto);
    });

    if (lista.length > 0 && (!clienteDireto || !clienteDiretoAindaExiste)) {
      setClienteDireto(lista[0].cnpj);
    }

    if (lista.length === 0) {
      setClienteDireto('');
    }
  } catch (error) {
    console.error('Erro ao carregar clientes:', error);
  }
}, [
  isConsult,
  isAdmin,
  user?.nome,
  user?.name,
  clienteDireto,
]);

  useEffect(() => {
    carregarClientes();
  }, [carregarClientes]);

  const anexarBoletoDireto = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (!clienteDireto) {
        alert('Selecione um cliente antes de anexar o boleto.');
        return;
      }

      if (!competenciaDireta) {
        alert('Informe a competência.');
        return;
      }

      const cnpjLimpo = normalizarCnpj(clienteDireto);
      const cliente = clientes.find(c => normalizarCnpj(c.cnpj) === cnpjLimpo);

      if (!cliente) {
        alert('Cliente selecionado não encontrado.');
        return;
      }

      setAnexandoDireto(true);

      const nomeSeguro = file.name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9.\-_]+/g, '_');

      const caminho = `clientes/${cnpjLimpo}/fust-funttel/${competenciaDireta}/${tipoBoletoDireto}/${Date.now()}_${nomeSeguro}`;

      const { error: uploadError } = await supabase.storage
        .from('boletos-fust-funttel')
        .upload(caminho, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from('fust_funttel_boletos')
        .insert({
          declaracao_id: null,
          cnpj: cnpjLimpo,
          competencia: competenciaDireta,
          tipo_boleto: tipoBoletoDireto,
          nome_original: file.name,
          arquivo_path: caminho,
          tamanho_bytes: file.size,
          tipo_arquivo: file.type || null,
          enviado_por: user?.id || null,
          enviado_por_nome: user?.name || user?.nome || user?.email || 'Usuário',
        });

      if (insertError) throw insertError;

      alert('Boleto anexado com sucesso! O cliente já pode baixar.');
      await carregarBoletos();
    } catch (error) {
      console.error('Erro ao anexar boleto direto:', error);
      alert(error.message || 'Não foi possível anexar o boleto.');
    } finally {
      setAnexandoDireto(false);
      event.target.value = '';
    }
  };

  const formatarCompetencia = (valor) => {
    if (!valor) return '—';

    const [ano, mes] = String(valor).split('-');

    const meses = [
      '',
      'Janeiro',
      'Fevereiro',
      'Março',
      'Abril',
      'Maio',
      'Junho',
      'Julho',
      'Agosto',
      'Setembro',
      'Outubro',
      'Novembro',
      'Dezembro',
    ];

    return `${meses[Number(mes)] || mes}/${ano}`;
  };

  const statusMap = {
    enviado: { label: 'Enviado ao consultor', color: 'blue' },
    em_processamento: { label: 'Em processamento', color: 'orange' },
    boleto_anexado: { label: 'Boleto anexado', color: 'green' },
    finalizado: { label: 'Finalizado', color: 'gray' },
  };

  // Agrupa "Meus boletos" do cliente por competência (mais recentes em cima).
  const meusBoletosAgrupados = isClient
    ? meusBoletos.reduce((acc, item) => {
        const k = item.competencia || 'sem_competencia';
        acc[k] = acc[k] || [];
        acc[k].push(item);
        return acc;
      }, {})
    : {};
  const meusBoletosCompetencias = Object.keys(meusBoletosAgrupados).sort((a, b) => b.localeCompare(a));

  const tipoBoletoCor = { fust: 'blue', funttel: 'green', outro: 'gray' };
  const tipoBoletoLabel = { fust: 'FUST', funttel: 'FUNTTEL', outro: 'Outro' };

  return (
    <div className="scm-fade-in">
      <input
  ref={fileRef}
  type="file"
  accept=".pdf,.png,.jpg,.jpeg,.webp"
  onChange={anexarBoleto}
  style={{ display: 'none' }}
/>
      {isClient && (
        <Card>
          <CardHead
            title="🧾 Meus boletos FUST/FUNTTEL"
            action={
              <Pill
                label={`${meusBoletos.length} ${meusBoletos.length === 1 ? 'boleto' : 'boletos'}`}
                color={meusBoletos.length > 0 ? 'green' : 'gray'}
              />
            }
          />

          <div style={{
            padding: '12px 16px',
            fontSize: 12,
            color: 'var(--muted)',
            borderBottom: '1px solid var(--border)',
            background: '#FAFAF7',
            lineHeight: 1.5,
          }}>
            Boletos anexados pela equipe SCM para sua empresa. Clique em <strong>⬇ Baixar</strong> para salvar o PDF.
          </div>

          {carregandoMeusBoletos && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
              Carregando boletos...
            </div>
          )}

          {!carregandoMeusBoletos && meusBoletos.length === 0 && (
            <Empty
              msg="Nenhum boleto recebido ainda"
              sub="Quando o consultor anexar boletos FUST/FUNTTEL para sua empresa, eles aparecerão aqui."
              icon="💰"
            />
          )}

          {!carregandoMeusBoletos && meusBoletosCompetencias.map(comp => {
            const lista = meusBoletosAgrupados[comp];
            return (
              <div key={comp}>
                <div style={{
                  padding: '11px 16px',
                  fontWeight: 700,
                  fontSize: 13,
                  background: '#FFF8F0',
                  borderTop: '1px solid var(--border)',
                  borderBottom: '1px solid #F5C9A0',
                  color: 'var(--orange-d)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}>
                  <span>📅 {formatarCompetencia(comp)}</span>
                  <Pill label={`${lista.length} ${lista.length === 1 ? 'guia' : 'guias'}`} color="orange" />
                </div>

                <Tbl headers={['Tipo', 'Arquivo', 'Anexado em', 'Anexado por', 'Baixar']}>
                  {lista.map(b => (
                    <TR key={b.id}>
                      <TD>
                        <Pill
                          label={tipoBoletoLabel[b.tipo_boleto] || String(b.tipo_boleto || '').toUpperCase()}
                          color={tipoBoletoCor[b.tipo_boleto] || 'gray'}
                        />
                      </TD>
                      <TD>
                        <div style={{ fontWeight: 600 }}>{b.nome_original || '—'}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                          {b.tipo_arquivo || ''}
                        </div>
                      </TD>
                      <TD mono>{new Date(b.criado_em).toLocaleString('pt-BR')}</TD>
                      <TD>{b.enviado_por_nome || 'Equipe SCM'}</TD>
                      <TD>
                        <Btn
                          size="sm"
                          variant="primary"
                          onClick={() => baixarBoleto(b)}
                        >
                          ⬇ Baixar
                        </Btn>
                      </TD>
                    </TR>
                  ))}
                </Tbl>
              </div>
            );
          })}
        </Card>
      )}

      {isClient && (
        <Card>
          <CardHead title="Enviar valores de FUST/FUNTTEL" />

          <div style={{ padding: 16 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, 1fr)',
              gap: 10,
              marginBottom: 14,
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>Competência</div>
                <input
                  type="month"
                  className="scm-input"
                  value={competencia}
                  onChange={(e) => setCompetencia(e.target.value)}
                />
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>Receita Bruta</div>
                <input
                  className="scm-input"
                  value={receitaBruta}
                  onChange={(e) => setReceitaBruta(e.target.value)}
                  placeholder="722.414,99"
                />
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>ICMS</div>
                <input
                  className="scm-input"
                  value={icms}
                  onChange={(e) => setIcms(e.target.value)}
                  placeholder="129.992,88"
                />
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>PIS</div>
                <input
                  className="scm-input"
                  value={pis}
                  onChange={(e) => setPis(e.target.value)}
                  placeholder="3.850,74"
                />
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>COFINS</div>
                <input
                  className="scm-input"
                  value={cofins}
                  onChange={(e) => setCofins(e.target.value)}
                  placeholder="17.772,66"
                />
              </div>
            </div>

            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'repeat(5, 1fr)',
              gap: 10,
              marginBottom: 14,
            }}>
              <StatCard value={numeroParaMoeda(calculo.deducoes)} label="Deduções" accent="orange" />
              <StatCard value={numeroParaMoeda(calculo.baseCalculo)} label="Base de cálculo" accent="black" />
              <StatCard value={numeroParaMoeda(calculo.fust)} label="FUST 1%" accent="blue" />
              <StatCard value={numeroParaMoeda(calculo.funttel)} label="FUNTTEL 0,5%" accent="green" />
              <StatCard value={numeroParaMoeda(calculo.total)} label="Total estimado" accent="gray" />
            </div>

            <textarea
              className="scm-input"
              rows={3}
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              placeholder="Observação opcional para o consultor..."
              style={{ resize: 'vertical', fontFamily: 'inherit', marginBottom: 12 }}
            />

            {erro && (
              <div style={{
                marginBottom: 12,
                padding: '10px 12px',
                borderRadius: 'var(--r-sm)',
                background: '#FFF0F0',
                color: 'var(--red)',
                border: '1px solid #F1C0BC',
                fontSize: 12,
              }}>
                {erro}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Btn variant="primary" onClick={enviarDeclaracao} disabled={salvando}>
                {salvando ? 'Enviando...' : 'Enviar para consultor'}
              </Btn>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHead
          title={isClient ? 'Meus envios de FUST/FUNTTEL' : 'FUST/FUNTTEL enviados pelos clientes'}
        />

        {carregando && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Carregando...
          </div>
        )}

        {!carregando && itens.length === 0 && (
          <Empty
            msg="Nenhum envio de FUST/FUNTTEL ainda"
            sub={isClient ? 'Preencha os valores acima e envie para a equipe SCM.' : 'Quando um cliente enviar, aparecerá aqui.'}
            icon="💰"
          />
        )}

        {!carregando && itens.length > 0 && (
          <Tbl headers={[
            'Cliente',
            'CNPJ',
            'Competência',
            'Receita Bruta',
            'ICMS',
            'PIS',
            'COFINS',
            'Base',
            'FUST 1%',
            'FUNTTEL 0,5%',
            'Total',
            'Status',
            'Ações',
          ]}>
            {itens.map(item => {
              const st = statusMap[item.status] || { label: item.status, color: 'gray' };
              const selecionado = itemSelecionado?.id === item.id;

              return (
                <TR key={item.id} onClick={() => setItemSelecionado(item)}>
                  <TD style={{ background: selecionado ? 'var(--orange-pale)' : undefined }}>
                    <strong>{item.cliente_nome || '—'}</strong>
                  </TD>
                  <TD mono>{item.cnpj || '—'}</TD>
                  <TD>{formatarCompetencia(item.competencia)}</TD>
                  <TD mono>{numeroParaMoeda(item.receita_bruta)}</TD>
                  <TD mono>{numeroParaMoeda(item.icms)}</TD>
                  <TD mono>{numeroParaMoeda(item.pis)}</TD>
                  <TD mono>{numeroParaMoeda(item.cofins)}</TD>
                  <TD mono>{numeroParaMoeda(item.base_calculo)}</TD>
                  <TD mono>{numeroParaMoeda(item.valor_fust)}</TD>
                  <TD mono>{numeroParaMoeda(item.valor_funttel)}</TD>
                  <TD mono><strong>{numeroParaMoeda(item.valor_total)}</strong></TD>
                  <TD>
                    <Pill label={st.label} color={st.color} />
                  </TD>
                  <TD onClick={(e) => e.stopPropagation()}>
                    <ActBtn
                      variant="view"
                      title="Ver detalhes / boletos"
                      onClick={() => setItemSelecionado(item)}
                    >
                      ◉
                    </ActBtn>
{(isConsult || isAdmin) && (
  <ActBtn
    variant="dl"
    title="Anexar boleto"
    onClick={() => {
      setTipoBoleto('fust');
      setModalAnexar(item);
    }}
  >
    📎
  </ActBtn>
)}
                    {(isConsult || isAdmin) && (
                      <ActBtn
                        variant="edit"
                        title="Marcar em processamento"
                        onClick={() => alterarStatus(item, 'em_processamento')}
                      >
                        ⚙
                      </ActBtn>
                    )}

                    {(isConsult || isAdmin) && (
                      <ActBtn
                        variant="dl"
                        title="Finalizar"
                        onClick={() => alterarStatus(item, 'finalizado')}
                      >
                        ✓
                      </ActBtn>
                    )}
                  </TD>
                </TR>
              );
            })}
          </Tbl>
        )}
      </Card>

      {itemSelecionado && (
        <Card>
          <CardHead
            title={
              isClient
                ? `Valores enviados — ${formatarCompetencia(itemSelecionado.competencia)}`
                : `Valores enviados pelo cliente — ${itemSelecionado.cliente_nome || 'Cliente'} — ${formatarCompetencia(itemSelecionado.competencia)}`
            }
            action={
              <Btn size="sm" onClick={() => setItemSelecionado(null)}>Fechar</Btn>
            }
          />

          <div style={{ padding: 16 }}>
            {/* Destaque do TOTAL com breakdown FUST + FUNTTEL */}
            <div style={{
              borderRadius: 'var(--r-md)',
              background: 'linear-gradient(135deg, var(--orange-pale) 0%, #FFFAF3 100%)',
              border: '1px solid #F5C9A0',
              padding: isMobile ? 16 : '20px 24px',
              marginBottom: 14,
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}>
              <div>
                <div style={{
                  fontSize: 10,
                  color: 'var(--orange-d)',
                  textTransform: 'uppercase',
                  letterSpacing: '.1em',
                  fontWeight: 700,
                  marginBottom: 6,
                }}>
                  💰 Total a recolher
                </div>
                <div style={{
                  fontSize: isMobile ? 28 : 34,
                  fontWeight: 700,
                  fontFamily: 'var(--mono)',
                  color: 'var(--orange-d)',
                  letterSpacing: '-.02em',
                  lineHeight: 1.05,
                }}>
                  {numeroParaMoeda(itemSelecionado.valor_total)}
                </div>
                <div style={{
                  fontSize: 11,
                  color: 'var(--muted)',
                  marginTop: 4,
                }}>
                  Competência {formatarCompetencia(itemSelecionado.competencia)}
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
                minWidth: isMobile ? undefined : 320,
              }}>
                <div style={{
                  background: '#fff',
                  border: '1px solid var(--blue-pale)',
                  borderLeft: '4px solid var(--blue)',
                  borderRadius: 'var(--r-sm)',
                  padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>FUST · 1%</div>
                  <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)', marginTop: 3 }}>
                    {numeroParaMoeda(itemSelecionado.valor_fust)}
                  </div>
                </div>

                <div style={{
                  background: '#fff',
                  border: '1px solid var(--green-pale)',
                  borderLeft: '4px solid var(--green)',
                  borderRadius: 'var(--r-sm)',
                  padding: '10px 12px',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>FUNTTEL · 0,5%</div>
                  <div style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)', marginTop: 3 }}>
                    {numeroParaMoeda(itemSelecionado.valor_funttel)}
                  </div>
                </div>
              </div>
            </div>

            {/* Receita Bruta e Base de cálculo em destaque */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
              gap: 10,
              marginBottom: 10,
            }}>
              <div style={{
                padding: '14px 16px',
                borderRadius: 'var(--r-md)',
                background: '#fff',
                border: '1px solid var(--border)',
                borderTop: '3px solid var(--admin-bg)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 4 }}>
                  Receita bruta
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--text)' }}>
                  {numeroParaMoeda(itemSelecionado.receita_bruta)}
                </div>
              </div>

              <div style={{
                padding: '14px 16px',
                borderRadius: 'var(--r-md)',
                background: '#fff',
                border: '1px solid var(--border)',
                borderTop: '3px solid var(--orange)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700, marginBottom: 4 }}>
                  Base de cálculo
                </div>
                <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--orange-d)' }}>
                  {numeroParaMoeda(itemSelecionado.base_calculo)}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                  Receita − Deduções
                </div>
              </div>
            </div>

            {/* Deduções detalhadas */}
            <div style={{
              padding: '12px 14px',
              borderRadius: 'var(--r-md)',
              background: '#FAFAF7',
              border: '1px solid var(--border)',
              marginBottom: 14,
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 10,
              }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: 700 }}>
                  Deduções
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--red)' }}>
                  − {numeroParaMoeda((Number(itemSelecionado.icms) || 0) + (Number(itemSelecionado.pis) || 0) + (Number(itemSelecionado.cofins) || 0))}
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                gap: 8,
              }}>
                {[
                  { label: 'ICMS', valor: itemSelecionado.icms },
                  { label: 'PIS', valor: itemSelecionado.pis },
                  { label: 'COFINS', valor: itemSelecionado.cofins },
                ].map(d => (
                  <div key={d.label} style={{
                    background: '#fff',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--r-sm)',
                    padding: '8px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em' }}>{d.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--mono)' }}>{numeroParaMoeda(d.valor)}</span>
                  </div>
                ))}
              </div>
            </div>

            {itemSelecionado.observacao && (
              <div style={{
                padding: '12px 14px',
                borderRadius: 'var(--r-sm)',
                background: '#FFF8F0',
                border: '1px solid #F5C9A0',
                fontSize: 13,
                lineHeight: 1.5,
              }}>
                <div style={{ fontSize: 11, color: 'var(--orange-d)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600, marginBottom: 4 }}>
                  Observação do cliente
                </div>
                {itemSelecionado.observacao}
              </div>
            )}
          </div>
        </Card>
      )}

{(isConsult || isAdmin) && itemSelecionado && (
        <Card>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.webp"
            onChange={anexarBoleto}
            style={{ display: 'none' }}
          />

          <CardHead
            title={`Boletos — ${itemSelecionado.cliente_nome || 'Cliente'} — ${formatarCompetencia(itemSelecionado.competencia)}`}
            action={
              (isConsult || isAdmin) ? (
                <Btn
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    setTipoBoleto('fust');
                    setModalAnexar(itemSelecionado);
                  }}
                >
                  📎 Anexar boleto
                </Btn>
              ) : null
            }
          />

          {(isConsult || isAdmin) && (
            <div style={{
              padding: '10px 16px',
              borderBottom: '1px solid var(--border)',
              background: '#FAFAF7',
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 600 }}>
                Tipo padrão ao anexar:
              </span>
              {[
                { v: 'fust', l: 'FUST', c: 'var(--blue)', cp: 'var(--blue-pale)' },
                { v: 'funttel', l: 'FUNTTEL', c: 'var(--green)', cp: 'var(--green-pale)' },
                { v: 'outro', l: 'Outro', c: 'var(--muted)', cp: '#EFEDE6' },
              ].map(t => {
                const ativo = tipoBoleto === t.v;
                return (
                  <button
                    key={t.v}
                    type="button"
                    onClick={() => setTipoBoleto(t.v)}
                    style={{
                      padding: '5px 12px',
                      borderRadius: 999,
                      border: ativo ? `1.5px solid ${t.c}` : '1px solid var(--border)',
                      background: ativo ? t.cp : '#fff',
                      color: ativo ? t.c : 'var(--text)',
                      fontWeight: ativo ? 700 : 500,
                      fontSize: 12,
                      cursor: 'pointer',
                      letterSpacing: '.03em',
                    }}
                  >
                    {t.l}
                  </button>
                );
              })}
            </div>
          )}

          {boletos.length === 0 ? (
            <div style={{ padding: 24, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
              Nenhum boleto anexado para esta competência.
            </div>
          ) : (
            <Tbl headers={['Tipo', 'Arquivo', 'Anexado por', 'Data', 'Ações']}>
              {boletos.map(boleto => (
                <TR key={boleto.id}>
                  <TD>
                    <Pill
                      label={tipoBoletoLabel[boleto.tipo_boleto] || String(boleto.tipo_boleto || '').toUpperCase()}
                      color={tipoBoletoCor[boleto.tipo_boleto] || 'gray'}
                    />
                  </TD>
                  <TD>{boleto.nome_original}</TD>
                  <TD>{boleto.enviado_por_nome || '—'}</TD>
                  <TD mono>{new Date(boleto.criado_em).toLocaleString('pt-BR')}</TD>
                  <TD>
                    <ActBtn variant="dl" title="Baixar boleto" onClick={() => baixarBoleto(boleto)}>
                      ⬇
                    </ActBtn>

                    {(isConsult || isAdmin) && (
                      <ActBtn variant="del" title="Excluir boleto" onClick={() => excluirBoleto(boleto)}>
                        ✕
                      </ActBtn>
                    )}
                  </TD>
                </TR>
              ))}
            </Tbl>
          )}
        </Card>
      )}

      {modalAnexar && (isConsult || isAdmin) && (
        <div
          onClick={() => setModalAnexar(null)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,.5)',
            zIndex: 1001,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: isMobile ? 0 : 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="scm-fade-in"
            style={{
              width: '100%',
              maxWidth: 520,
              maxHeight: isMobile ? '100dvh' : '88vh',
              height: isMobile ? '100dvh' : 'auto',
              display: 'flex', flexDirection: 'column',
              background: 'var(--card)',
              borderRadius: isMobile ? 0 : 'var(--r-lg)',
              overflow: 'hidden',
              boxShadow: '0 30px 60px rgba(0,0,0,.35)',
              border: '1px solid var(--border)',
            }}
          >
            {/* Header */}
            <div style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border)',
              background: 'linear-gradient(180deg,var(--orange-pale),transparent)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 'var(--r-md)',
                background: 'linear-gradient(180deg,var(--orange-l),var(--orange))',
                color: '#fff', fontSize: 18,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>📎</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Anexar boleto FUST/FUNTTEL</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {modalAnexar.cliente_nome || 'Cliente'} · {formatarCompetencia(modalAnexar.competencia)}
                </div>
              </div>
              <button
                onClick={() => setModalAnexar(null)}
                aria-label="Fechar"
                style={{
                  width: 36, height: 36, borderRadius: 'var(--r-sm)',
                  background: 'transparent', border: '1px solid var(--border)',
                  cursor: 'pointer', fontSize: 16, color: 'var(--muted)',
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: 18 }}>
              <div style={{
                fontSize: 11, color: 'var(--muted)',
                textTransform: 'uppercase', letterSpacing: '.06em',
                fontWeight: 600, marginBottom: 8,
              }}>
                1. Selecione o tipo do boleto
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
                gap: 8,
                marginBottom: 18,
              }}>
                {[
                  { v: 'fust',    l: 'FUST',    sub: '1% da base',    c: 'var(--blue)',   cp: 'var(--blue-pale)',   icon: '🔵' },
                  { v: 'funttel', l: 'FUNTTEL', sub: '0,5% da base',  c: 'var(--green)',  cp: 'var(--green-pale)',  icon: '🟢' },
                  { v: 'outro',   l: 'Outro',   sub: 'guia avulsa',   c: 'var(--muted)',  cp: '#EFEDE6',            icon: '⚪' },
                ].map(t => {
                  const ativo = tipoBoleto === t.v;
                  return (
                    <button
                      key={t.v}
                      type="button"
                      onClick={() => setTipoBoleto(t.v)}
                      style={{
                        padding: '14px 12px',
                        borderRadius: 'var(--r-md)',
                        border: ativo ? `2px solid ${t.c}` : '1px solid var(--border)',
                        background: ativo ? t.cp : '#fff',
                        color: ativo ? t.c : 'var(--text)',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'all .12s ease',
                      }}
                    >
                      <div style={{ fontSize: 18, marginBottom: 4 }}>{t.icon}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '.03em' }}>{t.l}</div>
                      <div style={{ fontSize: 10, color: ativo ? t.c : 'var(--muted)', marginTop: 2, opacity: .85 }}>{t.sub}</div>
                    </button>
                  );
                })}
              </div>

              <div style={{
                fontSize: 11, color: 'var(--muted)',
                textTransform: 'uppercase', letterSpacing: '.06em',
                fontWeight: 600, marginBottom: 8,
              }}>
                2. Escolha o arquivo (PDF ou imagem)
              </div>

              <Btn
                variant="primary"
                onClick={() => {
                  setItemSelecionado(modalAnexar);
                  setDeclaracaoUpload(modalAnexar);
                  setModalAnexar(null);
                  setTimeout(() => fileRef.current?.click(), 100);
                }}
                style={{ width: '100%' }}
              >
                📎 Selecionar arquivo do boleto {tipoBoletoLabel[tipoBoleto] || ''}
              </Btn>

              <div style={{
                marginTop: 12,
                fontSize: 11,
                color: 'var(--muted)',
                lineHeight: 1.5,
              }}>
                Formatos aceitos: PDF, PNG, JPG, JPEG, WEBP. O cliente será notificado e o status será atualizado para <strong>Boleto anexado</strong>.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==============================
   ANUIDADES (ANATEL / CREA-CFT / ANCINE)
   ============================== */
const ANUIDADES_CFG = {
  anatel:   { label: 'ANATEL',   cor: 'blue',   icone: '📡' },
  crea_cft: { label: 'CREA/CFT', cor: 'orange', icone: '🏗️' },
  ancine:   { label: 'ANCINE',   cor: 'green',  icone: '🎬' },
};

function ViewAnuidades({ tipo }) {
  const { user, isClient, isConsult, isAdmin } = useAuth();
  const isMobile = useMobile();

  const cfg = ANUIDADES_CFG[tipo] || ANUIDADES_CFG.anatel;
  const fileRef = React.useRef(null);

  const anoAtual = new Date().getFullYear();
  const anos = Array.from({ length: 8 }, (_, i) => String(anoAtual + 1 - i));

  const [ano, setAno] = useState(String(anoAtual));
  const [clientes, setClientes] = useState([]);
  const [clienteSelecionado, setClienteSelecionado] = useState('');
  const [observacao, setObservacao] = useState('');

  const [boletos, setBoletos] = useState([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');

  const carregarClientes = useCallback(async () => {
    if (!isConsult && !isAdmin) return;

    try {
      const { data, error } = await supabase
        .from('clientes')
        .select('*')
        .order('nome', { ascending: true });

      if (error) throw error;

      const lista = (data || []).map(c => ({ ...c, cnpj: normalizarCnpj(c.cnpj) }));
      setClientes(lista);

      if (lista.length > 0 && !clienteSelecionado) {
        setClienteSelecionado(lista[0].cnpj);
      }
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    }
  }, [isConsult, isAdmin, clienteSelecionado]);

  const carregarBoletos = useCallback(async () => {
    try {
      setCarregando(true);
      setErro('');

      let query = supabase
        .from('boletos_anuidades')
        .select('*')
        .eq('tipo', tipo)
        .order('ano', { ascending: false })
        .order('criado_em', { ascending: false });

      if (isClient) {
        query = query.eq('cnpj', normalizarCnpj(user?.cnpj));
      }

      const { data, error } = await query;

      if (error) throw error;

      setBoletos(data || []);
    } catch (error) {
      console.error(`Erro ao carregar boletos ${tipo}:`, error);
      setErro(error.message || 'Erro ao carregar boletos.');
    } finally {
      setCarregando(false);
    }
  }, [tipo, isClient, user?.cnpj]);

  useEffect(() => {
    carregarClientes();
    carregarBoletos();

    const ch = supabase
      .channel(`anuidades-${tipo}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'boletos_anuidades' }, () => carregarBoletos())
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [tipo, carregarClientes, carregarBoletos]);

const anexarBoleto = async (event) => {
  const file = event.target.files?.[0];

  if (!file) return;

  const declaracao = declaracaoUpload || itemSelecionado;

  try {
    if (!declaracao?.id) {
      alert('Selecione uma declaração antes de anexar o boleto.');
      return;
    }

    if (!declaracao.cnpj) {
      alert('Não foi possível identificar o CNPJ do cliente.');
      return;
    }

    if (!declaracao.competencia) {
      alert('Não foi possível identificar a competência.');
      return;
    }

    const nomeSeguro = file.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9.\-_]+/g, '_');

    const cnpjLimpo = normalizarCnpj(declaracao.cnpj);

    const caminho = `clientes/${cnpjLimpo}/fust-funttel/${declaracao.competencia}/${tipoBoleto}/${Date.now()}_${nomeSeguro}`;

    const { error: uploadError } = await supabase.storage
      .from('boletos-fust-funttel')
      .upload(caminho, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase
      .from('fust_funttel_boletos')
      .insert({
        declaracao_id: declaracao.id,
        cnpj: cnpjLimpo,
        competencia: declaracao.competencia,
        tipo_boleto: tipoBoleto,

        nome_original: file.name,
        arquivo_path: caminho,
        tamanho_bytes: file.size,
        tipo_arquivo: file.type || null,

        enviado_por: user?.id || null,
        enviado_por_nome: user?.name || user?.nome || user?.email || 'Usuário',
      });

    if (insertError) throw insertError;

    const { error: updateError } = await supabase
      .from('fust_funttel')
      .update({
        status: 'boleto_anexado',
        atualizado_em: new Date().toISOString(),
      })
      .eq('id', declaracao.id);

    if (updateError) throw updateError;

    alert('Boleto anexado com sucesso!');

    setItemSelecionado(declaracao);
    setDeclaracaoUpload(null);

    await carregar();
    await carregarBoletos();
  } catch (error) {
    console.error('Erro ao anexar boleto:', error);
    alert(error.message || 'Não foi possível anexar o boleto.');
  } finally {
    event.target.value = '';
  }
};

  const baixarBoleto = async (item) => {
    try {
      const { data, error } = await supabase.storage
        .from('boletos-anuidades')
        .download(item.arquivo_path);

      if (error) throw error;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(data);
      a.download = item.nome_original || 'boleto';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (error) {
      alert(error.message || 'Erro ao baixar boleto.');
    }
  };

  const excluirBoleto = async (item) => {
    if (!confirm('Deseja excluir este boleto?')) return;

    try {
      if (item.arquivo_path) {
        await supabase.storage.from('boletos-anuidades').remove([item.arquivo_path]);
      }
      const { error } = await supabase.from('boletos_anuidades').delete().eq('id', item.id);
      if (error) throw error;
      await carregarBoletos();
    } catch (error) {
      alert(error.message || 'Erro ao excluir boleto.');
    }
  };

  const formatarTamanho = (bytes) => {
    if (!bytes) return '—';
    const mb = bytes / 1024 / 1024;
    if (mb >= 1) return mb.toFixed(2) + ' MB';
    return (bytes / 1024).toFixed(1) + ' KB';
  };

  const boletosFiltrados = boletos.filter(item => {
    const q = busca.toLowerCase().trim();
    if (!q) return true;
    return (
      String(item.cliente_nome || '').toLowerCase().includes(q) ||
      String(item.cnpj || '').toLowerCase().includes(q) ||
      String(item.nome_original || '').toLowerCase().includes(q) ||
      String(item.ano || '').includes(q) ||
      String(item.observacao || '').toLowerCase().includes(q)
    );
  });

  const grupos = boletosFiltrados.reduce((acc, item) => {
    const k = item.ano || 'Sem ano';
    acc[k] = acc[k] || [];
    acc[k].push(item);
    return acc;
  }, {});

  const anosOrdenados = Object.keys(grupos).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="scm-fade-in">
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        onChange={anexarBoleto}
        style={{ display: 'none' }}
      />

      <Banner
        role={isClient ? 'client' : isAdmin ? 'admin' : 'consult'}
        icon={cfg.icone}
        title={`Anuidades ${cfg.label}`}
        sub={
          isClient
            ? `Acompanhe e baixe os boletos de anuidade da ${cfg.label} anexados pela equipe SCM.`
            : `Anexe os boletos anuais de ${cfg.label} para cada cliente.`
        }
      />

      {(isConsult || isAdmin) && (
        <Card>
          <CardHead title={`Anexar boleto de anuidade ${cfg.label}`} />

          <div style={{ padding: 16 }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : '1.6fr .8fr 2fr auto',
              gap: 10,
              alignItems: 'end',
            }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>
                  Cliente
                </div>
                <select
                  className="scm-input"
                  value={clienteSelecionado}
                  onChange={(e) => setClienteSelecionado(e.target.value)}
                >
                  <option value="">Selecione o cliente</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.cnpj}>{c.nome} — {c.cnpj}</option>
                  ))}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>
                  Ano
                </div>
                <select className="scm-input" value={ano} onChange={(e) => setAno(e.target.value)}>
                  {anos.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5, fontWeight: 600 }}>
                  Observação (opcional)
                </div>
                <input
                  className="scm-input"
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Ex: 1ª parcela, vencimento 30/06..."
                />
              </div>

              <Btn variant="primary" onClick={() => fileRef.current?.click()}>
                + Anexar boleto
              </Btn>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHead
          title={isClient ? `Meus boletos ${cfg.label}` : `Boletos ${cfg.label} dos clientes`}
          action={
            <input
              className="scm-input"
              placeholder="Buscar por cliente, CNPJ, ano ou arquivo..."
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              style={{ width: 260 }}
            />
          }
        />

        {carregando && (
          <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
            Carregando boletos...
          </div>
        )}

        {erro && (
          <div style={{ padding: 18, color: 'var(--red)', fontSize: 13 }}>{erro}</div>
        )}

        {!carregando && !erro && boletosFiltrados.length === 0 && (
          <Empty
            msg={`Nenhum boleto ${cfg.label} encontrado`}
            sub={isClient ? 'Quando a equipe SCM anexar boletos, eles aparecerão aqui.' : 'Anexe o primeiro boleto usando o formulário acima.'}
            icon={cfg.icone}
          />
        )}

        {!carregando && !erro && anosOrdenados.map(anoGrupo => (
          <div key={anoGrupo}>
            <div style={{
              padding: '12px 16px',
              fontWeight: 600,
              fontSize: 13,
              background: '#FAFAF8',
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}>
              <span>{cfg.icone} Anuidade {anoGrupo}</span>
              <Pill
                label={`${grupos[anoGrupo].length} ${grupos[anoGrupo].length === 1 ? 'boleto' : 'boletos'}`}
                color={cfg.cor}
              />
            </div>

            <Tbl headers={(isClient
              ? ['Arquivo', 'Observação', 'Anexado em', 'Anexado por', 'Tamanho', 'Ações']
              : ['Cliente', 'CNPJ', 'Arquivo', 'Observação', 'Anexado em', 'Anexado por', 'Tamanho', 'Ações']
            )}>
              {grupos[anoGrupo].map(item => (
                <TR key={item.id}>
                  {!isClient && <TD><strong>{item.cliente_nome || '—'}</strong></TD>}
                  {!isClient && <TD mono>{item.cnpj || '—'}</TD>}
                  <TD>
                    <div style={{ fontWeight: 500 }}>{item.nome_original || '—'}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                      {item.tipo_arquivo || 'Tipo não identificado'}
                    </div>
                  </TD>
                  <TD style={{ color: 'var(--muted)', fontSize: 12 }}>
                    {item.observacao || '—'}
                  </TD>
                  <TD mono>{new Date(item.criado_em).toLocaleString('pt-BR')}</TD>
                  <TD>{item.enviado_por_nome || '—'}</TD>
                  <TD mono>{formatarTamanho(item.tamanho_bytes)}</TD>
                  <TD>
                    <ActBtn variant="dl" title="Baixar boleto" onClick={() => baixarBoleto(item)}>⬇</ActBtn>
                    {(isConsult || isAdmin) && (
                      <ActBtn variant="del" title="Excluir boleto" onClick={() => excluirBoleto(item)}>✕</ActBtn>
                    )}
                  </TD>
                </TR>
              ))}
            </Tbl>
          </div>
        ))}
      </Card>
    </div>
  );
}

/* ==============================
   PORTAL LAYOUT
   ============================== */
function Portal() {
  const { user, isAdmin, isConsult, isClient, isSupervisor, logout } = useAuth();
  const isMobile = useMobile();
  const [view, setView] = useState(() => user?.role === 'supervisor' ? 'supervisor_dashboard' : 'dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Auto-logout de 1 hora para clientes com cronômetro regressivo
  const SESSAO_CLIENTE_SEGUNDOS = 3600;
  const [segundosRestantes, setSegundosRestantes] = useState(SESSAO_CLIENTE_SEGUNDOS);
  useEffect(() => {
    if (!isClient) return;
    setSegundosRestantes(SESSAO_CLIENTE_SEGUNDOS);
    const intervalo = setInterval(() => {
      setSegundosRestantes(s => {
        if (s <= 1) {
          clearInterval(intervalo);
          alert('Sua sessão expirou após 1 hora. Por segurança, você será desconectado.');
          logout();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(intervalo);
  }, [isClient, logout]);
  const formatarTempoSessao = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  // Background personalizado da supervisora (persistido por usuário)
  const bgStorageKey = user?.id ? `supervisor_bg_${user.id}` : null;
  useEffect(() => {
    if (user?.role === 'supervisor' && bgStorageKey) {
      const saved = localStorage.getItem(bgStorageKey);
      if (saved) document.documentElement.style.setProperty('--bg', saved);
      else document.documentElement.style.removeProperty('--bg');
    } else {
      document.documentElement.style.removeProperty('--bg');
    }
    return () => { document.documentElement.style.removeProperty('--bg'); };
  }, [user?.role, bgStorageKey]);

  const aplicarBgSupervisora = useCallback((cor) => {
    if (!bgStorageKey) return;
    if (cor) {
      localStorage.setItem(bgStorageKey, cor);
      document.documentElement.style.setProperty('--bg', cor);
    } else {
      localStorage.removeItem(bgStorageKey);
      document.documentElement.style.removeProperty('--bg');
    }
  }, [bgStorageKey]);

  const [bgPickerOpen, setBgPickerOpen] = useState(false);

  const navigate = useCallback((path) => {
    setSidebarOpen(false);
    if (path === 'import') { setView('dici'); return; }
    if (path === 'finalize') {
      if (window.confirm('Confirmar envio da coleta DICI de Junho 2025?\n\nApós o envio, os dados não poderão ser editados.'))
        alert('✓ Coleta enviada!\n\nA equipe SCM foi notificada e realizará o lançamento na Anatel.');
      return;
    }
    setView(path);
  }, []);

  useEffect(() => {
    document.body.style.overflow = (isMobile && sidebarOpen) ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isMobile, sidebarOpen]);

  const cfg = TOPBAR_CFG[view] || { title: view, sub: () => '', btns: { admin: [], consult: [], client: [] } };
  const tag = TAG_STYLE[user.role];
  const btns = cfg.btns[user.role] || [];

  const renderView = () => {
    switch (view) {
      case 'dashboard':    return <Dashboard onNav={navigate} />;
      case 'dici':         return <ViewDICI />;
      case 'planilhas':    return <ViewPlanilhas />;
      case 'docs':         return <ViewComprovantes />;
      case 'documentos':   return <ViewDocumentosGerais />;
      case 'integracoes':  return <ViewIntegracaoColetas />;
      case 'fust_funttel':       return <ViewFustFunttel />;
      case 'anuidades_anatel':   return <ViewAnuidades tipo="anatel" />;
      case 'anuidades_crea_cft': return <ViewAnuidades tipo="crea_cft" />;
      case 'anuidades_ancine':   return <ViewAnuidades tipo="ancine" />;
      case 'vistoria':
        return (isAdmin || isConsult)
          ? <ViewVistoria />
          : <Empty msg="Sem acesso" sub="Esta área é exclusiva de administradores e consultores." />;
      case 'feedback':     return <ViewFeedback />;
      case 'users':        return <ViewUsuarios />;
      case 'editor':       return <ViewEditor />;
      case 'perms':        return <ViewPermissoes />;
      case 'config':       return <ViewConfiguracoes />;
      case 'supervisor_dashboard':
        return (isSupervisor || isAdmin)
          ? <ViewSupervisorDashboard />
          : <Empty msg="Sem acesso" sub="Esta área é exclusiva do supervisor." />;
      case 'supervisor_agenda':
        return (isSupervisor || isAdmin)
          ? <ViewSupervisorAgenda />
          : <Empty msg="Sem acesso" sub="Esta área é exclusiva do supervisor." />;
      case 'supervisor_coletas':
        return (isSupervisor || isAdmin)
          ? <ViewSupervisorColetas />
          : <Empty msg="Sem acesso" sub="Esta área é exclusiva do supervisor." />;
      case 'supervisor_empresas':
        return (isSupervisor || isAdmin)
          ? <ViewSupervisorEmpresas />
          : <Empty msg="Sem acesso" sub="Esta área é exclusiva do supervisor." />;
      default:             return <Empty msg="Em implementação" sub="Esta seção será disponibilizada em breve." />;
    }
  };

  return <div style={{ display: 'flex', height: isMobile ? '100dvh' : '100vh' }}>
    {/* Backdrop mobile */}
    {isMobile && sidebarOpen && (
      <div onClick={() => setSidebarOpen(false)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40 }} />
    )}
    <Sidebar active={view} nav={navigate} isMobile={isMobile} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        height: 'var(--th)', background: 'var(--card)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center',
        padding: isMobile ? '0 12px' : '0 20px',
        gap: '11px', flexShrink: 0
      }}>
        {/* Hambúrguer — 44×44px touch target */}
        {isMobile && (
          <button onClick={() => setSidebarOpen(true)} aria-label="Abrir menu" style={{
            width: 44, height: 44, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 5,
            background: 'transparent', border: 'none', cursor: 'pointer',
            flexShrink: 0, padding: 0, touchAction: 'manipulation'
          }}>
            <span style={{ display: 'block', width: 20, height: 2, background: 'var(--text)', borderRadius: 2 }} />
            <span style={{ display: 'block', width: 20, height: 2, background: 'var(--text)', borderRadius: 2 }} />
            <span style={{ display: 'block', width: 20, height: 2, background: 'var(--text)', borderRadius: 2 }} />
          </button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: isMobile ? '14px' : '15px', fontWeight: 500,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
          }}>{cfg.title}</div>
          {!isMobile && <div style={{ fontSize: '11px', color: 'var(--faint)', marginTop: '1px' }}>{cfg.sub(user.role)}</div>}
        </div>
        <div style={{ flex: 1 }} />
        {!isMobile && <span style={{
          padding: '4px 9px', borderRadius: '6px', fontSize: '10px', fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: '.05em', background: tag.bg, color: tag.c,
          maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>
          {user.role === 'client'
            ? user.name
            : user.role === 'supervisor'
              ? `Dr. ${(user.name || '').toUpperCase()}`
              : tag.label}
        </span>}
        {!isMobile && isClient && (
          <span
            title="Tempo restante da sessão. Após 1 hora você será desconectado automaticamente."
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 9px', borderRadius: '6px',
              fontSize: '11px', fontWeight: 600, fontVariantNumeric: 'tabular-nums',
              background: segundosRestantes <= 300 ? '#FDECEC' : '#F4F1EA',
              color: segundosRestantes <= 300 ? '#B91C1C' : '#3F3F46',
              border: '1px solid var(--border)',
              whiteSpace: 'nowrap',
            }}
          >
            <span aria-hidden="true">⏱</span>
            {formatarTempoSessao(segundosRestantes)}
          </span>
        )}
        {!isMobile && isSupervisor && (
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setBgPickerOpen(o => !o)}
              title="Personalizar cor de fundo"
              style={{
                width: 30, height: 30, borderRadius: 'var(--r-sm)',
                border: '1px solid var(--border)', background: 'var(--card)',
                cursor: 'pointer', fontSize: 14, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
              }}
            >🎨</button>
            {bgPickerOpen && (
              <div style={{
                position: 'absolute', right: 0, top: 38, zIndex: 50,
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-md)', boxShadow: 'var(--sh-md)',
                padding: 12, width: 240,
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
                  Cor de fundo
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
                  
                  {['#FAFAF7','#F4F1EA','#EEF3FB','#E6F0F9','#F2EBF7','#FFF4EC','#EAF7EE','#FFF8E1','#FDECEC','#E8E8EC','#1F2937','#111315'].map(c => (
                    <button
                      key={c}
                      onClick={() => aplicarBgSupervisora(c)}
                      title={c}
                      style={{
                        width: '100%', aspectRatio: '1 / 1', borderRadius: 'var(--r-sm)',
                        border: '1px solid var(--border)', background: c, cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)', marginBottom: 8 }}>
                  <span>Personalizada:</span>
                  <input
                    type="color"
                    onChange={e => aplicarBgSupervisora(e.target.value)}
                    style={{ width: 36, height: 28, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                </label>
                <Btn variant="outline" size="sm" onClick={() => aplicarBgSupervisora(null)}>↺ Restaurar padrão</Btn>
              </div>
            )}
          </div>
        )}
        {!isMobile && btns.map(b => <Btn key={b.l} variant={b.var} size="sm" onClick={() => navigate(b.v)}>{b.l}</Btn>)}
      </div>
      {/* Content */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: isMobile ? '12px' : '19px',
        paddingBottom: isMobile ? 'calc(12px + var(--safe-bottom))' : '19px'
      }}>
        {renderView()}
      </div>
    </div>
    {isClient && <FloatingFeedbackButton />}
  </div>;
}

/* ==============================
   APP ROOT
   ============================== */
function App() {
  return <AuthProvider>
    <MobileProvider>
      <AppInner />
    </MobileProvider>
  </AuthProvider>;
}

function AppInner() {
  const { user, loadingAuth } = useAuth();

  if (loadingAuth) {
    return (
      <div style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
        fontSize: '13px'
      }}>
        Carregando portal...
      </div>
    );
  }

  return user ? <Portal /> : <Login />;
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);