-- 0059 : message de refus neutre (le droit valider_proforma est réglable par rôle).
do $$
declare v_def text; f text;
begin
  foreach f in array array['public.validate_proforma(uuid, text)', 'public.refuse_proforma(uuid, text)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    if position('Les commerciaux ne peuvent pas valider une proforma.' in v_def) > 0 then
      v_def := replace(v_def, 'Les commerciaux ne peuvent pas valider une proforma.', 'Vous n''''avez pas le droit de valider une proforma.');
      execute v_def;
    end if;
  end loop;
end;
$$;
