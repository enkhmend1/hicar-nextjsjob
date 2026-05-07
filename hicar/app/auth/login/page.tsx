import AuthNavbar from "@/app/components/AuthNavbar";
import LoginForm from "@/app/components/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gray-100">
      <AuthNavbar />

      <div className="flex items-center justify-center px-4 py-10">
        <LoginForm />
      </div>
    </div>
  );
}