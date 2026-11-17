-- =============================================================================
-- 0053 : Validations ouvertes à tous les rôles non commerciaux (précision du
-- 17/11/2026). Seuls les commerciaux (commercial, vendeur_showroom,
-- responsable_showroom) ne valident rien, pour ne pas engager de chiffres
-- avec le client sans accord de l'entreprise.
--
-- Valident les proformas, vérifient les bons de commande, préparent,
-- valident et émettent les factures : super_admin, administrateur (DG),
-- manager, responsable_commercial, admin_ventes (ADV), comptable.
-- Règle conservée : personne ne valide sa propre proforma.
-- is_direction() n'est pas modifiée (elle sert aussi au SAV).
-- =============================================================================
create or replace function public.is_proforma_validator() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in
    ('super_admin', 'administrateur', 'manager', 'responsable_commercial', 'admin_ventes', 'comptable');
$$;
create or replace function public.is_adv() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(auth_role()::text, '') in
    ('super_admin', 'administrateur', 'manager', 'responsable_commercial', 'admin_ventes', 'comptable');
$$;

do $$
declare
  v_def text;
  f text;
begin
  foreach f in array array['public.validate_invoice(uuid)', 'public.refuse_invoice(uuid, text)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_def := replace(v_def,
      $a$if not is_direction() then raise exception 'Seule la direction (manager, DG) valide une facture.'; end if;$a$,
      $b$if not is_adv() then raise exception 'Les commerciaux ne peuvent pas valider une facture.'; end if;$b$);
    if position('ne peuvent pas valider une facture' in v_def) = 0 then raise exception '% : motif introuvable', f; end if;
    execute v_def;
  end loop;

  foreach f in array array['public.validate_proforma(uuid, text)', 'public.refuse_proforma(uuid, text)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_def := replace(v_def,
      $a$'Seuls le responsable commercial, le manager et la direction valident une proforma.'$a$,
      $b$'Les commerciaux ne peuvent pas valider une proforma.'$b$);
    if position('ne peuvent pas valider une proforma' in v_def) = 0 then raise exception '% : motif introuvable', f; end if;
    execute v_def;
  end loop;

  v_def := pg_get_functiondef('public.check_commande(uuid, boolean, text)'::regprocedure);
  v_def := replace(v_def, $a$'Seule l''administration des ventes vérifie un bon de commande.'$a$,
                          $b$'Les commerciaux ne peuvent pas vérifier un bon de commande.'$b$);
  execute v_def;
  v_def := pg_get_functiondef('public.prepare_invoice(uuid, uuid[])'::regprocedure);
  v_def := replace(v_def, $a$'Seule l''administration des ventes prépare une facture.'$a$,
                          $b$'Les commerciaux ne peuvent pas préparer une facture.'$b$);
  execute v_def;
  v_def := pg_get_functiondef('public.issue_final_invoice(uuid)'::regprocedure);
  v_def := replace(v_def, $a$'Seule l''administration des ventes émet une facture.'$a$,
                          $b$'Les commerciaux ne peuvent pas émettre une facture.'$b$);
  execute v_def;
end;
$$;

-- 0053b : l'émission appelle convert_document puis apply_facture_stock, qui
-- gardaient leurs propres listes de rôles : on les aligne sur is_adv().
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.convert_document(uuid, text)'::regprocedure);
  v_def := replace(v_def,
    $a$    if v_role not in ('super_admin', 'administrateur', 'manager', 'admin_ventes') then$a$,
    $b$    if not is_adv() then$b$);
  if position('    if not is_adv() then' in v_def) = 0 then raise exception 'convert_document : motif introuvable'; end if;
  execute v_def;

  v_def := pg_get_functiondef('public.apply_facture_stock(uuid)'::regprocedure);
  v_def := replace(v_def,
    $a$     and auth_role()::text not in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes') then$a$,
    $b$     and auth_role()::text not in ('super_admin', 'administrateur', 'manager', 'comptable', 'receptionniste_sav', 'admin_ventes', 'responsable_commercial') then$b$);
  if position($x$'admin_ventes', 'responsable_commercial') then$x$ in v_def) = 0 then raise exception 'apply_facture_stock : motif introuvable'; end if;
  execute v_def;
end;
$$;

-- 0053c : à l'émission, la mise à jour de la facture créée se fait aussi en
-- contexte de confiance (sinon refusée pour un rôle qui n'est pas éditeur de
-- factures, ex. responsable_commercial).
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.issue_final_invoice(uuid)'::regprocedure);
  v_def := replace(v_def,
$a$  update documents
     set workflow_status = 'emise',$a$,
$b$  perform set_config('app.doc_guard_bypass', 'on', true);
  update documents
     set workflow_status = 'emise',$b$);
  if position($x$'on', true);
  update documents
     set workflow_status = 'emise',$x$ in v_def) = 0 then raise exception 'issue_final_invoice : motif introuvable'; end if;
  execute v_def;
end;
$$;
