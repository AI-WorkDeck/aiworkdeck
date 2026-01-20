'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export function ContactFormDialog({ triggerChild }: { triggerChild: React.ReactNode }) {
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    // Form state
    const [formData, setFormData] = useState({
        name: '',
        company: '',
        email: '',
        phone: '',
        requirements: ''
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const response = await fetch('http://localhost:8081/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData),
            });

            if (!response.ok) {
                throw new Error('Failed to submit');
            }

            setSuccess(true);
            setTimeout(() => {
                setOpen(false);
                setSuccess(false);
                setFormData({ name: '', company: '', email: '', phone: '', requirements: '' });
            }, 2000);
        } catch (err) {
            console.error(err);
            setError('Failed to send request. Please try again later.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                {triggerChild}
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                    <DialogTitle>Contact Sales</DialogTitle>
                    <DialogDescription>
                        Fill out the form below and our team will get back to you shortly.
                    </DialogDescription>
                </DialogHeader>

                {success ? (
                    <div className="py-8 text-center text-green-600 font-medium">
                        Message sent successfully!
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label htmlFor="name">Name *</Label>
                            <Input id="name" name="name" required value={formData.name} onChange={handleChange} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="company">Company *</Label>
                            <Input id="company" name="company" required value={formData.company} onChange={handleChange} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="email">Email *</Label>
                            <Input id="email" name="email" type="email" required value={formData.email} onChange={handleChange} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="phone">Phone (Optional)</Label>
                            <Input id="phone" name="phone" value={formData.phone} onChange={handleChange} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="requirements">Requirements</Label>
                            <Textarea id="requirements" name="requirements" value={formData.requirements} onChange={handleChange} />
                        </div>

                        {error && <p className="text-red-500 text-sm">{error}</p>}

                        <Button type="submit" disabled={loading} className="mt-2 bg-king-forest hover:bg-king-forest/90 text-white">
                            {loading ? 'Sending...' : 'Submit Request'}
                        </Button>
                    </form>
                )}
            </DialogContent>
        </Dialog>
    );
}
