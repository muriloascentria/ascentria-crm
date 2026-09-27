-- Retira a mensagem pronta "Não confirmou o SIM" (as duas partes), a pedido do Murilo.
delete from public.quick_replies where stage = 'confirmacao' and title = 'Não confirmou o SIM';
