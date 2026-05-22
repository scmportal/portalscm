import { supabase } from '../lib/supabase';

export async function buscarConsultorLogado() {
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    window.location.href = '../index.html';
    return null;
  }

  const { data: usuario, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  if (error || !usuario) {
    alert('Usuário não encontrado na tabela usuarios.');
    window.location.href = '../index.html';
    return null;
  }

  if (usuario.role !== 'consultor') {
    alert('Acesso permitido apenas para Consultor SCM.');
    window.location.href = '../index.html';
    return null;
  }

  return usuario;
}

export async function listarColetasConsultor() {
  const { data, error } = await supabase
    .from('planilhas_coleta')
    .select('*')
    .order('criado_em', { ascending: false });

  if (error) {
    console.error(error);
    throw new Error('Erro ao buscar coletas.');
  }

  return data;
}

export async function sairConsultor() {
  await supabase.auth.signOut();
  window.location.href = '../index.html';
}