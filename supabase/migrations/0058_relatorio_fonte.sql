-- Material da reunião (anotações do Gemini + transcrição) que a tarefa agendada "Relatórios da consultoria gratuita"
-- usa para escrever o relatório do lead (dores, desejos, caminhos: Processo de Enfermagem + Nursing Plan).
alter table public.deals
  add column if not exists relatorio_fonte text,
  add column if not exists relatorio_fonte_em timestamptz;
