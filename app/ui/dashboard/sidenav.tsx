import Link from 'next/link';
import NavLinks from '@/app/ui/dashboard/navlinks';
import { useState, useEffect } from 'react'; 

export default function SideNav() {

    const [open, setOpen] = useState(false);
      
    useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
        if (e.clientX < 50) {
          setOpen(true); // mouse near left edge → open
        } else if (e.clientX > 300) {
          setOpen(false); // mouse far from edge → close
        }
      };
  
      window.addEventListener('mousemove', handleMouseMove);
      return () => window.removeEventListener('mousemove', handleMouseMove);
    }, []);




  return (
    <div
    className={`fixed top-0 left-5 h-full bg-gray-50 shadow-lg w-64 transform transition-transform ease-in-out duration-300 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <Link
            className="mb-2 flex h-20 items-end justify-start rounded-md bg-blue-600 p-4 md:h-40"
            href="/"
        >
            <div className="w-32 text-white md:w-40">
            <p>Welcome</p>
            </div>
        </Link>
        <div className="flex grow flex-row justify-between space-x-2 md:flex-col md:space-x-0 md:space-y-2">
            <NavLinks />
            <div className="hidden h-auto w-full grow rounded-md bg-gray-50 md:block"></div>
            <form>
            <button className="flex h-[48px] w-full grow items-center justify-center gap-2 rounded-md bg-gray-50 p-3 text-sm font-medium hover:bg-sky-100 hover:text-blue-600 md:flex-none md:justify-start md:p-2 md:px-3">
                <div className="hidden md:block">Sign Out</div>
            </button>
            </form>
        </div>
    </div>
  );
}
