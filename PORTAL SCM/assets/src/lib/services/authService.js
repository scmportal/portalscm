import { supabase } from '../lib/supabase';

export async function login(email, senha) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: senha
  });

  if (error) {
    throw new Error('E-mail ou senha inválidos.');
  }

  return data;
}

export async function buscarUsuarioLogado() {
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return null;
  }

  const { data, error } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', authData.user.id)
    .single();

  if (error) {
    throw new Error('Usuário autenticado, mas não cadastrado na tabela usuarios.');
  }

  return data;
}

export async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error('Erro ao sair do sistema.');
  }
}