import AuthNavbar from "@/app/components/AuthNavbar";
import RegisterForm from "@/app/components/RegisterForm";

export default function RegisterPage() {
  return (
    <div className="min-h-screen bg-gray-100">
      <AuthNavbar />

      <div className="flex items-center justify-center px-4 py-10">
        <RegisterForm />
      </div>
    </div>
  );
}