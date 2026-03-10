/**
 * Supabase client initialization for NickelTrack.
 * The anon key is public by design — security is enforced via RLS policies.
 */
var NickelTrackSupabase = (function () {
  "use strict";
  var SUPABASE_URL = "https://lnfsjlileeeiuduvomao.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuZnNqbGlsZWVlaXVkdXZvbWFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTIyODYsImV4cCI6MjA4ODcyODI4Nn0.goHuuMFr6KtMlXqr00wjjSyNm7CCpEZ1V0uvKaPiIN8";
  var client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return { client: client };
})();
