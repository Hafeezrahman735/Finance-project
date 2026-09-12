import React from 'react'
import '../CSS/Income-page.css'

const Modal = ({ children, isOpen, onClose, title}) => {

    if(!isOpen) return null;
  return <div className='modal'>
    <div className='modal-total'>
        {/*modal content */}
        <div className='model-content'>
            {/*modal header*/}

            <div className='modal-header'>
                <h3 className='modal-title'>
                    {title}
                </h3>

                <button type="button" className='model-button' onClick={onClose}>
                    X
                </button>
            </div>

            {/* Modal body */}
            <div className='model-body'>
                {children}
            </div>
        </div>
    </div>
  </div>
}

export default Modal