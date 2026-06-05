import React, { useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { useAuth } from '../../context/AuthContext';
import { ShieldCheck, LogIn, UserPlus, AlertCircle, Loader2, Mail } from 'lucide-react';

const AuthView = () => {
  const { loginWithGoogle } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    try {
      setLoading(true); setError('');
      // loginWithGoogle in AuthContext handles both native (Capacitor GoogleAuth)
      // and web (signInWithPopup) — never call signInWithPopup directly here
      // as it fails in Android WebView.
      await loginWithGoogle();
    } catch (err: any) {
      const msg: string = err?.message || 'Google Sign-In failed.';
      if (!msg.includes('popup-closed') && !msg.includes('cancelled')) {
        setError(msg);
      }
    } finally { setLoading(false); }
  };

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError("Please fill all fields"); return; }
    try {
      setLoading(true); setError('');
      if (isLogin) await signInWithEmailAndPassword(auth, email, password);
      else await createUserWithEmailAndPassword(auth, email, password);
    } catch (err: any) {
      if (err.code === 'auth/invalid-credential') setError("Invalid email or password.");
      else if (err.code === 'auth/email-already-in-use') setError("Email already registered.");
      else if (err.code === 'auth/weak-password') setError("Password must be 6+ chars.");
      else setError(err.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="flex flex-col items-center justify-center p-6 relative safe-area-bottom" style={{background: 'var(--app-bg)', minHeight: '100dvh'}}>
      <div className="bg-[rgba(255,255,255,0.06)] w-full max-w-md rounded-3xl shadow-xl p-8 z-10 border border-[rgba(255,255,255,0.1)]">
        <div className="flex justify-center mb-6"><div className="w-20 h-20 rounded-3xl flex items-center justify-center shadow-xl transform rotate-3 hover:rotate-0 transition-all duration-500 bg-[rgba(124,58,237,0.3)] border border-[rgba(167,139,250,0.3)]"><ShieldCheck className="text-white" size={40} /></div></div>
        <h1 className="text-3xl font-black text-center text-[rgba(240,244,255,0.93)] mb-2 tracking-tight">{isLogin ? 'Welcome Back' : 'Join Now'}</h1>
        <p className="text-center text-slate-500 mb-8 text-sm font-medium">Secure Cloud Ledger for Business</p>
        {error && (<div className="bg-red-50 text-red-600 p-4 rounded-xl text-xs font-bold mb-6 flex items-start gap-3 animate-in slide-in-from-top-2 border border-red-100"><AlertCircle size={16} className="shrink-0 mt-0.5" /> <span>{error}</span></div>)}
        <form onSubmit={handleEmail} className="space-y-4">
          <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-1">Email Address</label><div className="relative"><Mail className="absolute left-3 top-3.5 text-slate-400" size={18}/><input type="email" className="w-full dark-input rounded-xl py-3 pl-10 pr-4 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/40 transition-all" placeholder="name@business.com" value={email} onChange={e => setEmail(e.target.value)}/></div></div>
          <div><label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 ml-1">Password</label><input type="password" className="w-full dark-input rounded-xl p-3 text-sm font-bold outline-none focus:ring-2 focus:ring-violet-500/40 transition-all" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)}/></div>
          <button type="submit" disabled={loading} className="w-full text-white py-4 rounded-xl font-bold text-base active:scale-95 transition-all flex items-center justify-center gap-2 mt-2" style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)'}}>{loading ? <Loader2 className="animate-spin" /> : (isLogin ? <LogIn size={20}/> : <UserPlus size={20}/>)} {isLogin ? 'Sign In' : 'Create Account'}</button>
        </form>
        <div className="relative my-8"><div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div><div className="relative flex justify-center text-[10px] uppercase tracking-widest"><span className="bg-[rgba(255,255,255,0.06)] px-2 text-slate-400 font-bold">Or continue with</span></div></div>
        <button onClick={handleGoogle} disabled={loading} className="w-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-[rgba(240,244,255,0.88)] py-3.5 rounded-xl font-bold text-sm active:scale-95 transition-all flex items-center justify-center gap-3">{loading ? <Loader2 className="animate-spin text-slate-400"/> : <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="G"/>} Continue with Google</button>
        <p className="text-center mt-8 text-sm text-slate-500 font-medium">{isLogin ? "New user?" : "Existing user?"} <button onClick={() => setIsLogin(!isLogin)} className="text-blue-600 font-bold ml-1 hover:underline">{isLogin ? 'Create Account' : 'Log In'}</button></p>
      </div>
      <div className="mt-8 text-slate-400 text-[10px] font-black uppercase tracking-widest opacity-50">Secured by Shop Ledger</div>
    </div>
  );
};
export default AuthView;
