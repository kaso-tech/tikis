# Références Supabase — Auth Phone et Realtime

## Auth Phone

Supabase Auth Phone nécessite l’activation du fournisseur Phone dans le tableau de bord Supabase et la configuration d’un prestataire SMS. Le client JavaScript utilise `supabase.auth.signInWithOtp({ phone })`, puis `supabase.auth.verifyOtp({ phone, token, type: "sms" })`. Une vérification réussie fournit un `access_token` de session.

Source : [Supabase Phone Login](https://supabase.com/docs/guides/auth/phone-login).

## Autorisation Realtime

Les canaux Broadcast privés requièrent `config: { private: true }` côté client et des politiques RLS sur `realtime.messages`. La politique peut exploiter `realtime.topic()` et `auth.uid()` afin de n’autoriser que les participants à une livraison. Le réglage « Allow public access » doit être désactivé dans les paramètres Realtime du projet. Les droits sont évalués à la connexion du canal et une session JWT active doit être renouvelée avant expiration.

Source : [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization).

## JWT modernes

Supabase Auth émet des JWT de session à durée courte. Avec des clés de signature asymétriques, la vérification serveur s’effectue via le JWKS de `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` et une bibliothèque de vérification JWT ; aucun ancien JWT Secret n’est requis.

Source : [Supabase JWT](https://supabase.com/docs/guides/auth/jwts).
