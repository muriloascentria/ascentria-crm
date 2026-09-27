-- As três mensagens de exemplo da 0013 ficaram sem etapa ("Outras") e não devem aparecer.
-- O texto delas continua guardado no arquivo 0013_quick_replies.sql, se um dia precisar voltar.
delete from public.quick_replies
where stage is null
  and title in ('Melhor período','Confirmar interesse','Enviar horários');
