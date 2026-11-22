// Тестбенч задания «Разворот»: огонёк идёт к LED5, S1 разворачивает, S2 сбрасывает.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BOUNCE = 3;

    reg        clk = 1'b0;
    reg  [1:0] btn = 2'b00;           // btn[0] = S1, btn[1] = S2
    wire [5:0] led;

    always #18.5 clk = ~clk;

    // CLK_HZ = 2400: антидребезг раз в 24 такта, шаг огонька раз в 300 тактов.
    top #(.CLK_HZ(2400)) dut (.clk(clk), .btn_s1(btn[0]), .btn_s2(btn[1]), .led(led));

    wire [5:0] on = ~led;
    integer    errors = 0;

    task move (input integer i, input v);
        integer k;
        begin
            for (k = 0; k < BOUNCE; k = k + 1) begin
                btn[i] = v;   #60;
                btn[i] = ~v;  #40;
            end
            btn[i] = v;
        end
    endtask

    // Дождаться n шагов огонька (тик внутри dut) и сверить положение.
    task steps (input integer n, input [5:0] want);
        begin
            repeat (n) begin
                @(posedge dut.tick);          // тик пришёл...
                @(posedge clk);               // ...на этом фронте кольцо шагнуло
            end
            @(negedge clk);
            $display("%b   %b", on, want);
            if (on !== want) errors = errors + 1;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        $display("LED5..0  ожидали");
        steps(2, 6'b000100);                       // два шага к LED5
        move(0, 1'b1); #3000; move(0, 1'b0); #3000; // S1: разворот (между шагами)
        steps(2, 6'b000001);                       // обратно к LED0
        steps(1, 6'b100000);                       // и через край по кольцу
        move(1, 1'b1); #3000;                      // S2 нажали: сброс
        $display("%b   %b  (S2 держим)", on, 6'b000001);
        if (on !== 6'b000001) errors = errors + 1;
        steps(1, 6'b000001);                       // пока S2 нажата, огонёк стоит
        move(1, 1'b0); #3000;
        steps(2, 6'b000100);                       // после сброса снова к LED5

        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
